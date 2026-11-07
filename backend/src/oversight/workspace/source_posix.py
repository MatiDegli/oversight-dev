"""Read-only POSIX selection and independently verified, disposable COPY handoffs.

These leaves grant no runtime reset or execution authority. The caller must hold its runtime
lock and satisfy trust/prior-runtime policy before inspection. All placements must already
exist; this module creates only fresh staging children, never the original or runtime root.
"""

import hashlib
import json
import os
import re
import stat
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from uuid import uuid4

from oversight.workspace.errors import SourceChanged
from oversight.workspace.locks import offload
from oversight.workspace.runner import ProcessResult, Spawn, run_process
from oversight.workspace.secret_paths import is_secret_path
from oversight.workspace.source_config import check_source_config
from oversight.workspace.source_posix_git import (
    GitLayout,
    inspect_layout,
    metadata,
    recheck_layout,
)
from oversight.workspace.source_posix_git import (
    warnings as git_warnings,
)
from oversight.workspace.source_posix_identity import excluded_identities
from oversight.workspace.source_posix_io import (
    DEFAULT_BUDGETS,
    absolute,
    anchors,
    budget_scope,
    budgets,
    changed,
    directory,
    directory_names,
    entry,
    identity,
    read_file,
    refuse,
    relative,
    remaining,
)
from oversight.workspace.source_posix_io import (
    ROOT_UID as ROOT_UID,
)
from oversight.workspace.source_posix_io import (
    AdmissionBudgets as AdmissionBudgets,
)
from oversight.workspace.source_posix_io import (
    FileEntry as FileEntry,
)
from oversight.workspace.source_posix_io import (
    Witness as Witness,
)
from oversight.workspace.source_posix_io import (
    secure as secure,
)
from oversight.workspace.source_posix_io import (
    token as token,
)
from oversight.workspace.source_posix_policy import (
    DEFAULT_POLICY,
    Disclosure,
    Mount,
    check_case,
    disclosure,
    inspect_source_mount,
    inspection,
)
from oversight.workspace.source_posix_policy import (
    AdmissionPolicy as AdmissionPolicy,
)
from oversight.workspace.source_posix_policy import (
    require_linux_state as require_linux_state,
)

__all__ = [
    "FileEntry",
    "Inventory",
    "PosixSource",
    "Selection",
    "StagedSource",
    "Witness",
    "absolute",
    "cleanup_stage",
    "directory",
    "directory_names",
    "identity",
    "inventory",
    "manifest_bytes",
    "prepare_source",
    "read_file",
    "relative",
    "remaining",
    "stage_source",
    "validate_selection",
    "verify_stage",
]

PACKAGE_ROOT = Path(__file__).resolve().parents[4]
PHASE_SECONDS = 10
MAX_GIT = 8 * 1024 * 1024
MAX_PATHS = 16384
MAX_FILE = 4 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
# Filesystem root ownership is the host trust anchor, including mapped user namespaces.
EXCLUDED = frozenset(
    {
        ".git",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".pyright",
        ".tox",
        ".nox",
        ".cache",
        ".runtime",
        "dist",
        "build",
        ".next",
        "htmlcov",
        ".coverage",
        "coverage",
    }
)


@dataclass(frozen=True)
class PosixSource:
    root: Path
    runtime: Path
    ide: Path
    reviewed_checkout: Path
    placements: tuple[Witness, ...]
    budgets: AdmissionBudgets = DEFAULT_BUDGETS
    excluded: tuple[Path, ...] = ()
    source_layouts: tuple[GitLayout, ...] = ()
    policy: AdmissionPolicy = DEFAULT_POLICY
    disclosure: Disclosure | None = field(default=None, compare=False)
    source_mount: Mount | None = None
    runtime_mount: Mount | None = None

    @property
    def protected(self) -> tuple[Path, ...]:
        return (self.runtime, self.ide, PACKAGE_ROOT, self.reviewed_checkout, *self.excluded)


def _placement(
    source: Path,
    runtime: Path,
    ide: Path,
    reviewed_checkout: Path,
    budget: AdmissionBudgets = DEFAULT_BUDGETS,
    excluded: tuple[Path, ...] = (),
    policy: AdmissionPolicy = DEFAULT_POLICY,
) -> PosixSource:
    for path in (source, runtime, ide, reviewed_checkout):
        absolute(path)
    for other in (runtime,):
        if source.is_relative_to(other) or other.is_relative_to(source):
            raise refuse("source/runtime or running checkout ancestor overlap")
    runtime_mount = require_linux_state(runtime)
    source_mount = inspect_source_mount(source)
    source_chain, runtime_chain, ide_chain = (anchors(p) for p in (source, runtime, ide))
    for other in (runtime_chain,):
        # Bind aliases preserve inode identity even when their lexical names differ.
        if source_chain[-1].identity[:2] in {w.identity[:2] for w in other} or (
            other[-1].identity[:2] in {w.identity[:2] for w in source_chain}
        ):
            raise refuse("filesystem alias overlaps source placement")
    roots = (ide, PACKAGE_ROOT, *excluded)
    if os.path.lexists(reviewed_checkout):
        roots += (reviewed_checkout,)
    exclusions, layouts = excluded_identities(
        source, roots, time.monotonic() + budget.phase_seconds
    )
    _metadata_placement(layouts, runtime, runtime_chain)
    return PosixSource(
        source,
        runtime,
        ide,
        reviewed_checkout,
        tuple(dict.fromkeys((*source_chain, *runtime_chain, *ide_chain, *exclusions))),
        budget,
        excluded,
        layouts,
        policy,
        None,
        source_mount,
        runtime_mount,
    )


def _metadata_placement(
    layouts: tuple[GitLayout, ...], runtime: Path, runtime_chain: tuple[Witness, ...]
) -> None:
    for layout in layouts:
        for witness in layout.directories:
            path = witness.path
            if (
                path.is_relative_to(runtime)
                or runtime.is_relative_to(path)
                or witness.identity[:2] in {w.identity[:2] for w in runtime_chain}
                or runtime_chain[-1].identity[:2] in {w.identity[:2] for w in anchors(path)}
            ):
                raise refuse(
                    "runtime overlaps the selected Git metadata; choose a separate "
                    "private Linux state directory",
                    "runtime-unavailable",
                )


async def prepare_source(
    source: Path,
    runtime: Path,
    ide: Path,
    *,
    reviewed_checkout: Path,
    budget: AdmissionBudgets = DEFAULT_BUDGETS,
    excluded: tuple[Path, ...] = (),
    policy: AdmissionPolicy = DEFAULT_POLICY,
) -> PosixSource:
    """No writes. The caller supplies the reviewed checkout from the base runtime."""
    protected = (runtime, ide, PACKAGE_ROOT, reviewed_checkout, *excluded)
    with budget_scope(budget), inspection(policy, protected) as state:
        try:
            prepared = await offload(
                lambda: _placement(
                    source, runtime, ide, reviewed_checkout, budget, excluded, policy
                )
            )
        except PermissionError:
            raise refuse(
                "cannot read source or placement; check directory permissions", "source-permissions"
            ) from None
        return replace(prepared, disclosure=state.disclosure())


def recheck_source(source: PosixSource) -> None:
    with inspection(source.policy, source.protected, source.disclosure):
        if (
            _placement(
                source.root,
                source.runtime,
                source.ide,
                source.reviewed_checkout,
                source.budgets,
                source.excluded,
                source.policy,
            )
            != source
        ):
            raise changed("placement changed since validation")


def recheck_tree(source: PosixSource, tree: Path) -> None:
    """A disposable test tree is a strict descendant of the validated runtime."""
    recheck_source(source)
    absolute(tree)
    if not tree.is_relative_to(source.runtime) or tree in {source.runtime, source.ide}:
        raise refuse("disposable tree must be inside the validated runtime")
    _placement(
        source.root,
        tree,
        source.ide,
        source.reviewed_checkout,
        source.budgets,
        source.excluded,
        source.policy,
    )


def selected(path: str) -> bool:
    parts = relative(path)
    if any(part.casefold() == ".gitmodules" for part in parts):
        raise refuse("submodule metadata")
    return not (
        is_secret_path(path, nt=False)
        or any(p in EXCLUDED or p.endswith((".egg-info", ".dist-info")) for p in parts)
        or path.endswith((".pyc", ".pyo"))
    )


def records(text: str) -> tuple[str, ...]:
    if text and (not text.endswith("\0") or "\ufffd" in text):
        raise refuse("malformed or non-UTF-8 Git output")
    rows = tuple(text[:-1].split("\0")) if text else ()
    if len(rows) > budgets().max_paths:
        raise refuse(
            "Git record budget exceeded; increase the admission path budget",
            "source-budget-exceeded",
        )
    if any(not row for row in rows):
        raise refuse("empty Git record")
    return rows


def repository_layout(source: PosixSource, deadline: float) -> frozenset[str]:
    recheck_source(source)
    for parent in source.root.parents:
        marker = parent / ".git"
        if os.path.lexists(marker):
            # An empty plain directory has no Git metadata and is not a repository.
            # Some managed filesystems reserve such directories against git discovery.
            with directory(marker) as fd:
                if directory_names(fd, deadline):
                    raise refuse("source is nested inside another repository")
    # Scan eligible directories, including ignored ones: a nested repository with no
    # selected files must not silently become an ordinary input after a later edit.
    pending = [source.root]
    actual: set[str] = set()
    count = 0
    while pending:
        path = pending.pop()
        with directory(path) as fd:
            names = directory_names(fd, deadline)
            check_case(fd, names)
            for name in names:
                remaining(deadline)
                count += 1
                if count > budgets().max_paths:
                    raise refuse("working input entry budget exceeded", "source-budget-exceeded")
                if name.casefold() in {".git", ".gitmodules"}:
                    if path != source.root or name != ".git":
                        raise refuse("nested repository or submodule metadata")
                    continue
                rel = str((path / name).relative_to(source.root))
                if selected(rel):
                    actual.add(rel)
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        pending.append(path / name)
                    elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                        raise refuse("link, special or multiple-link working input")

    return frozenset(actual)


@dataclass(frozen=True)
class Inventory:
    source: PosixSource
    head: str
    paths: tuple[str, ...]
    tracked: frozenset[str]
    metadata: tuple[FileEntry, ...]
    deadline: float
    layout: GitLayout
    warnings: tuple[str, ...] = ()
    disclosure: Disclosure | None = field(default=None, compare=False)


@dataclass(frozen=True)
class _GitQuery:
    source: PosixSource
    git: str
    spawn: Spawn
    deadline: float
    layout: GitLayout
    witness: tuple[FileEntry, ...]

    @property
    def env(self) -> dict[str, str]:
        return {
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_DIR": str(self.layout.gitdir),
            "GIT_WORK_TREE": str(self.source.root),
            "GIT_NO_REPLACE_OBJECTS": "1",
            "GIT_ATTR_NOSYSTEM": "1",
        }

    async def __call__(self, *args: str) -> str:
        flags = [
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.untrackedCache=false",
            "-c",
            "core.sparseCheckout=false",
        ]
        result = await self.run(
            [self.git, *flags, *args],
            cwd=self.source.runtime,
            env=self.env,
            timeout_s=remaining(self.deadline),
            output_cap=budgets().max_git,
        )
        return result.stdout

    async def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_s: float,
        env: Mapping[str, str] | None = None,
        output_cap: int = MAX_GIT,
    ) -> ProcessResult:
        await offload(lambda: recheck_source(self.source))
        await offload(lambda: recheck_layout(self.source.root, self.layout, self.deadline))
        if (
            env is not None
            and "GIT_DIR" in env
            and await offload(lambda: metadata(self.source.root, self.deadline)) != self.witness
        ):
            raise changed("Git metadata changed before repository query")
        output_cap = min(output_cap, budgets().max_git)
        result = await self._spawn(
            argv,
            cwd=cwd,
            env=env,
            timeout_s=min(timeout_s, remaining(self.deadline)),
            output_cap=output_cap,
        )
        remaining(self.deadline)
        if (
            result.returncode != 0
            or result.timed_out
            or result.truncated
            or (len((result.stdout + result.stderr).encode()) > output_cap)
        ):
            category = (
                "source-budget-exceeded"
                if result.timed_out or result.truncated
                else ("unsafe-git-config" if "--no-includes" in argv else "not-standalone-repo")
            )
            raise refuse(
                "failed, timed-out or truncated Git query; inspect Git configuration "
                "or increase the admission budget",
                category,
            )
        return result

    async def _spawn(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str] | None,
        timeout_s: float,
        output_cap: int,
    ) -> ProcessResult:
        try:
            return await self.spawn(
                argv, cwd=cwd, env=env, timeout_s=timeout_s, output_cap=output_cap
            )
        except FileNotFoundError:
            raise refuse(
                "Git is missing; install git inside this Linux distribution", "missing-git"
            ) from None
        except PermissionError:
            raise refuse(
                "cannot execute Git; check its executable permissions", "source-permissions"
            ) from None


def _config_record(key: str, value: str) -> None:
    allowed_core = {
        "repositoryformatversion",
        "filemode",
        "bare",
        "logallrefupdates",
        "ignorecase",
        "precomposeunicode",
        "symlinks",
        "autocrlf",
        "eol",
        "protecthfs",
        "protectntfs",
        "quotepath",
    }
    if (
        (key.startswith("core.") and key[5:] not in allowed_core)
        or (
            key.startswith("extensions.")
            and (key, value)
            not in {("extensions.objectformat", "sha256"), ("extensions.worktreeconfig", "true")}
        )
        or key.startswith(("include.", "includeif."))
        or (key == "core.bare" and value != "false")
        or (
            key == "core.symlinks"
            and value.lower() not in {"true", "false", "yes", "no", "on", "off", "1", "0", ""}
        )
    ):
        raise refuse(
            "unsafe Git configuration; remove unsafe settings and retry", "unsafe-git-config"
        )


async def _check_config(query: _GitQuery) -> None:
    for base in dict.fromkeys((query.layout.common, query.layout.gitdir)):
        await check_source_config(
            base,
            git=query.git,
            spawn=query.run,
            env=query.env,
            time_left=lambda: remaining(query.deadline),
            refuse=lambda reason: refuse(reason, "unsafe-git-config"),
            validate=_config_record,
        )


def _tracked(text: str) -> frozenset[str]:
    tracked: set[str] = set()
    seen: set[str] = set()
    for row in records(text):
        match = re.fullmatch(r"(100644|100755) ([0-9a-f]{40}|[0-9a-f]{64}) 0\t(.+)", row)
        if match is None:
            raise refuse("malformed index, conflict, link or gitlink")
        path = match[3]
        if path in seen:
            raise refuse("duplicate index record")
        seen.add(path)
        if selected(path):
            tracked.add(path)
    return frozenset(tracked)


async def inventory(
    source: PosixSource, *, git: str, spawn: Spawn = run_process, deadline: float | None = None
) -> Inventory:
    """Retry changing witnesses within one deadline, before handing off a selection."""
    with (
        budget_scope(source.budgets),
        inspection(source.policy, source.protected, source.disclosure),
    ):
        until = min(
            (deadline if deadline is not None else float("inf")),
            time.monotonic() + budgets().phase_seconds,
        )
        for attempt in range(budgets().witness_retries + 1):
            try:
                return await _inventory(source, git=git, spawn=spawn, deadline=until)
            except SourceChanged:
                if attempt == budgets().witness_retries:
                    raise changed("source keeps changing; stop other writers and retry") from None
    raise AssertionError("unreachable")


async def _inventory(
    source: PosixSource, *, git: str, spawn: Spawn = run_process, deadline: float | None = None
) -> Inventory:
    """Read-only Git queries under a single ten-second deadline and bounded outputs."""
    until = (
        min(deadline, time.monotonic() + budgets().phase_seconds)
        if deadline is not None
        else (time.monotonic() + budgets().phase_seconds)
    )
    absolute(Path(git))
    actual = await offload(lambda: repository_layout(source, until))
    layout = await offload(lambda: inspect_layout(source.root, until))
    before = await offload(lambda: metadata(source.root, until))
    query = _GitQuery(source, git, spawn, until, layout, before)
    await _check_config(query)
    if await offload(lambda: metadata(source.root, until)) != before:
        raise changed("Git metadata changed before inspection")
    head = await query("rev-parse", "--verify", "HEAD")
    if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\n", head):
        raise refuse("malformed source HEAD")
    tracked = _tracked(await query("ls-files", "-s", "-z"))
    rows = records(await query("ls-files", "-z", "--cached", "--others", "--exclude-standard"))
    if len(rows) != len(set(rows)):
        raise refuse("duplicate selected Git record")
    paths = {p for p in rows if selected(p)}
    if not tracked.issubset(paths):
        raise refuse("incomplete selected Git output")
    if await offload(lambda: metadata(source.root, until)) != before:
        raise changed("Git metadata changed during inventory")
    await offload(lambda: _representable(source.root, paths, actual))
    notices = await offload(lambda: git_warnings(layout, until))
    report = disclosure()
    notices = tuple(sorted(set(notices) | set(report.warnings if report else ())))
    return Inventory(
        source, head.strip(), tuple(sorted(paths)), tracked, before, until, layout, notices, report
    )


def _representable(root: Path, paths: set[str], actual: frozenset[str]) -> None:
    for name in paths - actual:
        if os.path.lexists(root / name):
            raise refuse(
                "Git path case differs from actual source names; normalize the index "
                "and working tree before retrying",
                "unsupported-location",
            )


@dataclass(frozen=True)
class Selection:
    inventory: Inventory
    entries: tuple[FileEntry, ...]
    directories: tuple[Witness, ...]
    total_bytes: int
    disclosure: Disclosure | None = field(default=None, compare=False)


def _validate(listing: Inventory) -> Selection:
    source, until = listing.source, listing.deadline
    recheck_source(source)
    if metadata(source.root, until) != listing.metadata:
        raise changed("Git metadata changed before validation")
    if any(e.path.endswith("/info/attributes") and e.size for e in listing.metadata):
        raise refuse("source info attributes are unsupported")
    directories: dict[Path, tuple[int, ...]] = {}
    entries: list[FileEntry] = []
    total = 0
    for name in listing.paths:
        if not selected(name):
            raise refuse("excluded inventory handoff")
        path = source.root / name
        # Only existing input ancestors get witnessed. Missing tracked parents denote
        # working deletions; an untracked disappearance always refuses in entry().
        current = source.root
        for part in ("", *relative(name)[:-1]):
            current = current / part if part else current
            # Keep the first witness for the final check. Per-file reads still pin
            # and check all ancestors; shared witnesses need only be recorded once.
            if current in directories:
                continue
            try:
                with directory(current):
                    directories[current] = token(current.lstat())
            except FileNotFoundError:
                if name not in listing.tracked:
                    raise refuse("untracked parent disappeared") from None
                break
        item = entry(source.root, name, until, missing=name in listing.tracked)
        if item.sha256 is not None and Path(name).name.casefold() == ".gitattributes":
            _attributes(read_file(source.root / name, until)[0])
        total += item.size
        if total > budgets().max_total or len(directories) + len(entries) >= budgets().max_paths:
            raise refuse("selected paths or bytes exceed budget", "source-budget-exceeded")
        entries.append(item)
    for path, stamp in directories.items():
        with directory(path):
            if token(path.lstat()) != stamp:
                raise changed("source directory changed")
    if metadata(source.root, until) != listing.metadata:
        raise changed("Git metadata changed during validation")
    return Selection(
        listing,
        tuple(entries),
        tuple(Witness(p, t) for p, t in sorted(directories.items())),
        total,
        disclosure(),
    )


def _attributes(data: bytes) -> None:
    if b"\0" in data:
        raise refuse("NUL in source attributes")
    for line in data.removeprefix(b"\xef\xbb\xbf").split(b"\n"):
        line = line.strip(b" \t\r")
        if not line or line.startswith(b"#"):
            continue
        fields = re.split(rb"[ \t\r]+", line)
        if (
            line.startswith(b'"')
            or fields[0].startswith(b"[attr]")
            or any(
                f.lstrip(b"-!").split(b"=", 1)[0] in {b"filter", b"ident", b"working-tree-encoding"}
                for f in fields[1:]
            )
        ):
            raise refuse("unsupported source attribute transform")


async def validate_selection(listing: Inventory) -> Selection:
    with (
        budget_scope(listing.source.budgets),
        inspection(listing.source.policy, listing.source.protected, listing.disclosure),
    ):
        return await offload(lambda: _validate(listing))


@dataclass(frozen=True)
class StagedSource:
    selection: Selection
    root: Path
    tree: Path
    manifest: Path
    owned: tuple[Witness, ...]
    files: tuple[FileEntry, ...]
    disclosure: Disclosure | None = field(default=None, compare=False)


def manifest_bytes(selection: Selection) -> bytes:
    return json.dumps(
        {
            "head": selection.inventory.head,
            "entries": [[e.path, e.sha256, e.size, e.mode] for e in selection.entries],
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()


def _create(path: Path, owned: list[Witness], *, data: bytes | None = None, mode: int = 0o600):
    with directory(path.parent) as fd:
        if data is None:
            os.mkdir(path.name, mode=0o700, dir_fd=fd)
            owned.append(
                Witness(path, identity(os.stat(path.name, dir_fd=fd, follow_symlinks=False)))
            )
        else:
            child = os.open(
                path.name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                mode,
                dir_fd=fd,
            )
            try:
                owned.append(Witness(path, identity(os.fstat(child))))
                view = memoryview(data)
                while view:
                    count = os.write(child, view)
                    if count <= 0:
                        raise refuse("short staging write")
                    view = view[count:]
                os.fchmod(child, mode)
                owned[-1] = Witness(path, identity(os.fstat(child)))
            finally:
                os.close(child)


def _copy(selection: Selection, root: Path, owned: list[Witness], deadline: float) -> StagedSource:
    _create(root, owned)
    tree, manifest = root / "tree", root / "manifest"
    _create(tree, owned)
    dirs: set[str] = set()
    for item in selection.entries:
        remaining(deadline)
        if item.sha256 is None:
            continue
        data, stamp = read_file(selection.inventory.source.root / item.path, deadline)
        if stamp != item.identity or hashlib.sha256(data).hexdigest() != item.sha256:
            raise changed("selected file changed during COPY")
        parts = relative(item.path)
        for i in range(1, len(parts)):
            name = "/".join(parts[:i])
            if name not in dirs:
                _create(tree / name, owned)
                dirs.add(name)
        _create(tree / item.path, owned, data=data, mode=0o700 if item.mode & 0o111 else 0o600)
    _create(manifest, owned, data=manifest_bytes(selection))
    files = tuple(entry(tree, e.path, deadline) for e in selection.entries if e.sha256 is not None)
    return StagedSource(selection, root, tree, manifest, tuple(owned), files)


def _owned(owned: tuple[Witness, ...], deadline: float, *, missing: bool) -> None:
    paths = {w.path for w in owned}
    for witness in owned:
        remaining(deadline)
        try:
            with directory(witness.path.parent) as fd:
                info = os.stat(witness.path.name, dir_fd=fd, follow_symlinks=False)
                if identity(info) != witness.identity:
                    raise refuse("owned staging identity changed; preserve for recovery")
                if stat.S_ISDIR(info.st_mode):
                    with directory(witness.path) as child:
                        if any(
                            witness.path / n not in paths for n in directory_names(child, deadline)
                        ):
                            raise refuse("unexpected staging entry; preserve for recovery")
        except FileNotFoundError:
            if not missing:
                raise refuse("missing staging entry") from None


def _cleanup(owned: tuple[Witness, ...]) -> None:
    deadline = time.monotonic() + budgets().phase_seconds
    _owned(owned, deadline, missing=True)  # Preflight every identity before any deletion.
    for witness in reversed(owned):
        remaining(deadline)
        try:
            with directory(witness.path.parent) as fd:
                info = os.stat(witness.path.name, dir_fd=fd, follow_symlinks=False)
                if identity(info) != witness.identity:
                    raise refuse("staging replacement during cleanup; preserve for recovery")
                if stat.S_ISDIR(info.st_mode):
                    os.rmdir(witness.path.name, dir_fd=fd)
                else:
                    os.unlink(witness.path.name, dir_fd=fd)
        except FileNotFoundError:
            continue


async def cleanup_stage(stage: StagedSource) -> None:
    """Delete exact recorded identities only; substituted or unexpected entries refuse."""

    def cleanup() -> None:
        _stage_layout(stage)
        _cleanup(stage.owned)

    await offload(cleanup)


def _stage_layout(stage: StagedSource) -> None:
    if (
        stage.root.parent != stage.selection.inventory.source.runtime
        or not re.fullmatch(r"source-stage-[0-9a-f]{32}", stage.root.name)
        or stage.tree != stage.root / "tree"
        or stage.manifest != stage.root / "manifest"
    ):
        raise refuse("unowned staging handoff")
    if (
        not stage.owned
        or stage.owned[0].path != stage.root
        or (len({w.path for w in stage.owned}) != len(stage.owned))
        or any(not w.path.is_relative_to(stage.root) for w in stage.owned)
    ):
        raise refuse("invalid staging ownership manifest")


def _verify(stage: StagedSource, deadline: float) -> None:
    recheck_source(stage.selection.inventory.source)
    _stage_layout(stage)
    _owned(stage.owned, deadline, missing=False)
    data, _ = read_file(stage.manifest, deadline)
    if data != manifest_bytes(stage.selection):
        raise refuse("staging manifest changed")
    expected = [(e.path, e.sha256, e.size) for e in stage.selection.entries if e.sha256 is not None]
    actual = tuple(entry(stage.tree, e.path, deadline) for e in stage.files)
    if actual != stage.files or [(e.path, e.sha256, e.size) for e in actual] != expected:
        raise refuse("staging bytes or identity changed")


async def verify_stage(stage: StagedSource, *, deadline: float | None = None) -> None:
    """Independently verify membership, inode identities, hashes and manifest before use."""
    source = stage.selection.inventory.source
    until = min(
        deadline if deadline is not None else float("inf"),
        time.monotonic() + source.budgets.phase_seconds,
    )
    with (
        budget_scope(source.budgets),
        inspection(source.policy, source.protected, stage.disclosure),
    ):
        await offload(lambda: _verify(stage, until))


async def _stage_source(
    selection: Selection, *, git: str, spawn: Spawn = run_process
) -> StagedSource:
    """Fresh staging only; recheck source selection before/after, verify before return.

    Cancellation joins filesystem work before identity-scoped cleanup. Failed cleanup raises
    and retains the remaining stage for caller recovery; it never recursively deletes a tree.
    The caller owns the successful handoff and must verify again immediately before use.
    """
    until = time.monotonic() + budgets().phase_seconds
    listing = replace(selection.inventory, deadline=until)
    expected = replace(selection, inventory=listing)
    root = listing.source.runtime / ("source-stage-" + uuid4().hex)
    owned: list[Witness] = []
    try:
        if await validate_selection(listing) != expected:
            raise changed("selection changed before COPY")
        again = await inventory(listing.source, git=git, spawn=spawn, deadline=until)
        if replace(again, deadline=until) != listing:
            raise changed("Git selection changed before COPY")
        stage = await offload(lambda: _copy(expected, root, owned, until))
        if await validate_selection(listing) != expected:
            raise changed("source changed during COPY")
        again = await inventory(listing.source, git=git, spawn=spawn, deadline=until)
        if replace(again, deadline=until) != listing:
            raise changed("Git selection changed during COPY")
        await verify_stage(stage, deadline=until)
        return stage
    except BaseException:
        await offload(lambda: _cleanup(tuple(owned)))
        raise


async def stage_source(
    selection: Selection, *, git: str, spawn: Spawn = run_process
) -> StagedSource:
    source = selection.inventory.source
    with (
        budget_scope(source.budgets),
        inspection(source.policy, source.protected, selection.disclosure),
    ):
        try:
            stage = await _stage_source(selection, git=git, spawn=spawn)
        except FileExistsError:
            raise refuse(
                "snapshot names collide in staging; choose a case-sensitive Linux runtime",
                "unsupported-location",
            ) from None
        return replace(stage, disclosure=disclosure())
