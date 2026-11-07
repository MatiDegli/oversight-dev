"""Bounded Git control witnesses; object storage is never enumerated.

Repository queries may resolve objects, but admission copies only independently hashed working
bytes. Unrelated objects, logs and other worktrees are deliberately outside the witness set.
"""

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path

from oversight.workspace.errors import StartupRefusal
from oversight.workspace.source_posix_io import (
    FileEntry,
    Witness,
    absolute,
    budgets,
    changed,
    directory,
    directory_names,
    identity,
    read_file,
    refuse,
    relative,
    remaining,
    token,
)


@dataclass(frozen=True)
class GitLayout:
    gitdir: Path
    common: Path
    directories: tuple[Witness, ...]
    pointers: tuple[FileEntry, ...]


def _file(path: Path, deadline: float) -> FileEntry:
    try:
        data, stamp = read_file(path, deadline, limit=budgets().max_git)
    except FileNotFoundError:
        return FileEntry(str(path), None, None, 0, 0)
    except OSError as error:
        if isinstance(error, StartupRefusal) and error.refusal_category != "other":
            raise
        if path.name in {"config", "config.worktree"}:
            raise refuse(
                "unsafe Git config file; replace it with a private regular file",
                "unsafe-git-config",
            ) from None
        raise
    return FileEntry(
        str(path), stamp, hashlib.sha256(data).hexdigest(), len(data), stamp[2] & 0o777
    )


def _pointer(
    path: Path, deadline: float, prefix: bytes = b"", *, file_target: bool = False
) -> tuple[Path, FileEntry]:
    record = _file(path, deadline)
    data, stamp = read_file(path, deadline, limit=4096)
    if stamp != record.identity:
        raise changed("Git pointer changed during read")
    if not data.startswith(prefix) or not data.endswith(b"\n") or b"\0" in data:
        raise refuse("invalid Git directory pointer")
    try:
        name = data[len(prefix) :].removesuffix(b"\n").decode("utf-8", "strict")
    except UnicodeError:
        raise refuse("unrepresentable Git directory pointer") from None
    if not name or "\n" in name or "\r" in name:
        raise refuse("invalid Git directory pointer")
    # Git writes relative commondir pointers with '..'. Normalize only this control input;
    # every resulting path component is opened without following symlinks.
    target = Path("/") if name.startswith("/") else path.parent
    parts = name.split("/")
    for index, part in enumerate(parts):
        remaining(deadline)
        if not part or part == ".":
            continue
        if part == "..":
            target = target.parent
        else:
            target /= part
        if index < len(parts) - 1 or not file_target:
            with directory(target):
                pass
    absolute(target)
    return target, record


def inspect_layout(root: Path, deadline: float) -> GitLayout:
    marker = root / ".git"
    pointers: list[FileEntry] = []
    if stat.S_ISREG(marker.lstat().st_mode):
        gitdir, pointer = _pointer(marker, deadline, b"gitdir: ")
        pointers.append(pointer)
    else:
        gitdir = marker
    if gitdir != marker and gitdir.is_relative_to(root):
        raise refuse("Git directory must be outside selected working inputs")
    with directory(gitdir) as fd:
        git_stamp = Witness(gitdir, identity(os.fstat(fd)))
    common = gitdir
    if os.path.lexists(gitdir / "commondir"):
        common, pointer = _pointer(gitdir / "commondir", deadline)
        pointers.append(pointer)
    else:
        pointers.append(_file(gitdir / "commondir", deadline))
    with directory(common) as fd:
        common_stamp = Witness(common, identity(os.fstat(fd)))
    if gitdir != marker:
        if common != gitdir or os.path.lexists(gitdir / "gitdir"):
            backlink, pointer = _pointer(gitdir / "gitdir", deadline, file_target=True)
            if backlink != marker:
                raise refuse("linked worktree Git directory does not point back to selection")
            pointers.append(pointer)
        else:
            pointers.append(_file(gitdir / "gitdir", deadline))
    elif common != gitdir or os.path.lexists(gitdir / "gitdir"):
        raise refuse("inconsistent Git directory layout")
    return GitLayout(gitdir, common, (git_stamp, common_stamp), tuple(pointers))


def recheck_layout(root: Path, layout: GitLayout, deadline: float) -> None:
    if inspect_layout(root, deadline) != layout:
        raise changed("Git directory identity changed")


def _refs(base: Path, deadline: float) -> tuple[FileEntry, ...]:
    """Walk refs only, with the same entry/time budgets as working paths."""
    found: list[FileEntry] = []
    pending = [base]
    while pending:
        path = pending.pop()
        try:
            with directory(path) as fd:
                found.append(FileEntry(str(path), token(os.fstat(fd)), None, 0, 0))
                names = directory_names(fd, deadline)
                for name in names:
                    relative(name)
                    child = path / name
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        pending.append(child)
                    else:
                        found.append(_file(child, deadline))
                    if len(found) + len(pending) > budgets().max_paths:
                        raise refuse("Git ref entry budget exceeded", "source-budget-exceeded")
        except FileNotFoundError:
            found.append(FileEntry(str(path), None, None, 0, 0))
        remaining(deadline)
    return tuple(found)


def metadata(root: Path, deadline: float) -> tuple[FileEntry, ...]:
    layout = inspect_layout(root, deadline)
    found = list(layout.pointers)
    for witness in layout.directories:
        found.append(FileEntry(str(witness.path), witness.identity, None, 0, 0))
    # Direct known-path probes keep this independent of object count/size/link count.
    for base in dict.fromkeys((layout.gitdir, layout.common)):
        # Pin known metadata parents without listing even one object-storage directory.
        for name in ("info", "objects", "objects/info", "objects/pack"):
            path = base / name
            try:
                with directory(path) as fd:
                    found.append(FileEntry(str(path), identity(os.fstat(fd)), None, 0, 0))
            except FileNotFoundError:
                found.append(FileEntry(str(path), None, None, 0, 0))
        for name in (
            "modules",
            "info/grafts",
            "objects/info/alternates",
            "objects/info/http-alternates",
            "refs/replace",
        ):
            if os.path.lexists(base / name):
                raise refuse("forbidden Git metadata: " + name)
        for name in (
            "HEAD",
            "index",
            "config",
            "config.worktree",
            "packed-refs",
            "shallow",
            "info/attributes",
            "info/exclude",
        ):
            found.append(_file(base / name, deadline))
        found.extend(_refs(base / "refs", deadline))
    recheck_layout(root, layout, deadline)
    return tuple(sorted(found, key=lambda item: item.path))


def warnings(layout: GitLayout, deadline: float) -> tuple[str, ...]:
    """Locks are advisory evidence of another writer; never remove or acquire them."""
    paths = {
        base / name
        for base in (layout.gitdir, layout.common)
        for name in (
            "HEAD.lock",
            "index.lock",
            "config.lock",
            "config.worktree.lock",
            "packed-refs.lock",
            "shallow.lock",
            "objects/maintenance.lock",
            "gc.pid",
        )
    }
    paths.update(
        Path(e.path) for e in _refs(layout.common / "refs", deadline) if e.path.endswith(".lock")
    )
    if any(os.path.lexists(path) for path in paths):
        return (
            "Git lock files are present (possibly stale); admission leaves them unchanged. "
            "Stop other writers and inspect locks before removing any manually.",
        )
    return ()
