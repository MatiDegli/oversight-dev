"""No-follow POSIX readers shared by the admission leaves."""

import hashlib
import os
import stat
import time
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path

from oversight.workspace.errors import SourceChanged, StartupRefusal

MAX_PATHS = 16384
MAX_FILE = 4 * 1024 * 1024
ROOT_UID = os.stat("/").st_uid


@dataclass(frozen=True)
class AdmissionBudgets:
    phase_seconds: float = 10
    max_git: int = 8 * 1024 * 1024
    max_paths: int = MAX_PATHS
    max_file: int = MAX_FILE
    max_total: int = 128 * 1024 * 1024
    witness_retries: int = 2

    def __post_init__(self) -> None:
        if (
            not 0 < self.phase_seconds < float("inf")
            or any(v <= 0 for v in (self.max_git, self.max_paths, self.max_file, self.max_total))
            or self.witness_retries < 0
        ):
            raise ValueError("admission budgets must be finite and positive; retries nonnegative")


DEFAULT_BUDGETS = AdmissionBudgets()

_budget: ContextVar[AdmissionBudgets] = ContextVar(
    "source_admission_budget", default=DEFAULT_BUDGETS
)


def budgets() -> AdmissionBudgets:
    return _budget.get()


@contextmanager
def budget_scope(value: AdmissionBudgets) -> Generator[None]:
    marker = _budget.set(value)
    try:
        yield
    finally:
        _budget.reset(marker)


def refuse(reason: str, category: str = "other") -> OSError:
    return StartupRefusal("POSIX source refused: " + reason, category)


def changed(reason: str) -> SourceChanged:
    return SourceChanged("POSIX source refused: " + reason)


def remaining(deadline: float) -> float:
    left = deadline - time.monotonic()
    if left <= 0:
        raise refuse("phase deadline exceeded")
    return left


def absolute(path: Path) -> Path:
    raw = str(path)
    if (
        not raw.startswith("/")
        or raw.startswith("//")
        or any(p in {".", ".."} for p in raw.split("/"))
        or any(ord(c) < 32 for c in raw)
    ):
        raise refuse("canonical absolute POSIX path required")
    if path != Path("/"):
        relative(raw[1:])
    return path


def relative(path: str) -> tuple[str, ...]:
    parts = tuple(path.split("/"))
    if (
        len(path.encode("utf-8", "surrogatepass")) > 4096
        or len(parts) > 64
        or any(
            not p
            or p in {".", ".."}
            or len(p.encode("utf-8", "surrogatepass")) > 255
            or any(ord(c) < 32 or 0xD800 <= ord(c) <= 0xDFFF for c in p)
            for p in parts
        )
    ):
        raise refuse("unsafe relative path")
    return parts


def directory_names(fd: int, deadline: float) -> tuple[str, ...]:
    names: list[str] = []
    with os.scandir(fd) as entries:
        for item in entries:
            remaining(deadline)
            if len(names) >= budgets().max_paths:
                raise refuse("directory entry budget exceeded")
            names.append(item.name)
    return tuple(sorted(names))


def identity(info: os.stat_result) -> tuple[int, ...]:
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid


def token(info: os.stat_result) -> tuple[int, ...]:
    return (*identity(info), info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def secure(info: os.stat_result, *, sticky_ancestor: bool = False) -> None:
    if info.st_uid not in {ROOT_UID, os.geteuid()} or (
        info.st_mode & 0o022
        and not (sticky_ancestor and info.st_uid == ROOT_UID and info.st_mode & stat.S_ISVTX)
    ):
        raise refuse("unsafe ownership or writable ancestor/input")


@dataclass(frozen=True)
class Witness:
    path: Path
    identity: tuple[int, ...]


@contextmanager
def directory(path: Path) -> Generator[int]:
    """Pin every ancestor with O_NOFOLLOW; compare names again before closing descriptors."""
    absolute(path)
    descriptors: list[int] = []
    witnesses: list[Witness] = []
    current = Path("/")
    try:
        fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        descriptors.append(fd)
        for part in path.parts[1:]:
            secure(os.fstat(fd), sticky_ancestor=True)
            current /= part
            fd = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd
            )
            descriptors.append(fd)
            witnesses.append(Witness(current, identity(os.fstat(fd))))
        secure(os.fstat(fd), sticky_ancestor=True)
        yield fd
        for witness in witnesses:
            if identity(witness.path.lstat()) != witness.identity:
                raise changed("directory identity changed")
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def read_file(
    path: Path, deadline: float, *, limit: int | None = None, hardlinks: bool = False
) -> tuple[bytes, tuple[int, ...]]:
    remaining(deadline)
    limit = budgets().max_file if limit is None else limit
    with directory(path.parent) as parent:
        fd = os.open(
            path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent
        )
        try:
            before = os.fstat(fd)
            secure(before)
            if not stat.S_ISREG(before.st_mode) or (not hardlinks and before.st_nlink != 1):
                raise refuse("nonregular or multiple-link input")
            if before.st_size > limit:
                raise refuse("file byte budget exceeded")
            data = bytearray()
            while len(data) <= limit:
                remaining(deadline)
                chunk = os.read(fd, min(65536, limit + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            if (
                len(data) != before.st_size
                or token(os.fstat(fd)) != token(before)
                or (
                    token(os.stat(path.name, dir_fd=parent, follow_symlinks=False)) != token(before)
                )
            ):
                raise changed("file identity or bytes changed during read")
            return bytes(data), token(before)
        finally:
            os.close(fd)


def anchors(path: Path) -> tuple[Witness, ...]:
    with directory(path):
        secure(path.lstat())
        return tuple(Witness(p, identity(p.lstat())) for p in (*reversed(path.parents), path))


@dataclass(frozen=True)
class FileEntry:
    path: str
    identity: tuple[int, ...] | None
    sha256: str | None
    size: int
    mode: int


def entry(root: Path, name: str, deadline: float, *, missing: bool = False) -> FileEntry:
    relative(name)
    try:
        data, stamp = read_file(root / name, deadline)
    except FileNotFoundError:
        if not missing:
            raise refuse("untracked input disappeared") from None
        return FileEntry(name, None, None, 0, 0)
    return FileEntry(name, stamp, hashlib.sha256(data).hexdigest(), len(data), stamp[2] & 0o777)
