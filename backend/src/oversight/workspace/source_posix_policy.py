"""Internal person-selected admission policy and disclosure data, without persistence.

Public startup remains disabled. A later caller must persist a loosening receipt before using
these leaves for execution; informational trust never substitutes for that authority.
"""

import errno
import os
import re
import stat
import struct
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path

from oversight.workspace.errors import StartupRefusal


@dataclass(frozen=True)
class AdmissionPolicy:
    writer_risk_reason: str | None = None

    def __post_init__(self) -> None:
        if self.writer_risk_reason is not None and not self.writer_risk_reason.strip():
            raise ValueError("writer risk requires the person's explicit reason")

    @property
    def receipt_required(self) -> bool:
        return self.writer_risk_reason is not None


DEFAULT_POLICY = AdmissionPolicy()


@dataclass(frozen=True)
class Exposure:
    path: Path
    uid: int
    gid: int
    mode: int
    private_group_members: tuple[int, ...] | None
    other_writers: bool


@dataclass(frozen=True)
class Disclosure:
    uid: int
    effective_uid: int
    is_root: bool
    filesystem_root_uid: int
    policy: AdmissionPolicy
    warnings: tuple[str, ...]
    exposures: tuple[Exposure, ...]


@dataclass
class _Inspection:
    policy: AdmissionPolicy
    protected: tuple[Path, ...]
    warnings: set[str] = field(default_factory=lambda: set[str]())
    exposures: set[Exposure] = field(default_factory=lambda: set[Exposure]())
    groups: dict[int, tuple[int, ...] | None] = field(
        default_factory=lambda: dict[int, tuple[int, ...] | None]()
    )

    def disclosure(self) -> Disclosure:
        return Disclosure(
            os.getuid(),
            os.geteuid(),
            os.geteuid() == 0,
            os.stat("/").st_uid,
            self.policy,
            tuple(sorted(self.warnings)),
            tuple(sorted(self.exposures, key=lambda e: str(e.path))),
        )


_inspection: ContextVar[_Inspection | None] = ContextVar("posix_source_policy", default=None)


@contextmanager
def inspection(
    policy: AdmissionPolicy, protected: tuple[Path, ...], previous: Disclosure | None = None
) -> Generator[_Inspection]:
    existing = _inspection.get()
    state = (
        existing
        if existing and existing.policy == policy and existing.protected == protected
        else _Inspection(policy, protected)
    )
    if previous is not None:
        state.warnings.update(previous.warnings)
        state.exposures.update(previous.exposures)
    if policy.receipt_required:
        state.warnings.add(
            "Person-selected writer risk: other users may change source inputs during admission. "
            "Revoke this policy to restore default refusal; "
            "a persisted receipt is required before use."
        )
    marker = _inspection.set(state)
    try:
        yield state
    finally:
        _inspection.reset(marker)


def disclosure() -> Disclosure | None:
    state = _inspection.get()
    return state.disclosure() if state else None


def source_input(path: Path) -> bool:
    state = _inspection.get()
    return state is not None and not any(path.is_relative_to(root) for root in state.protected)


def accounts_enumerable() -> bool:
    # Directory services can disable enumeration while still resolving individual users.
    # Their empty primary-GID listing cannot certify a user-private group.
    try:
        with Path("/etc/nsswitch.conf").open() as stream:
            text = stream.read(65537)
        if len(text) > 65536:
            return False
        databases: dict[str, tuple[str, ...]] = {}
        for line in text.splitlines():
            key, _, values = line.partition("#")[0].partition(":")
            if key.strip() in {"passwd", "group"}:
                databases[key.strip()] = tuple(values.split())
        return all(
            databases.get(key) and set(databases[key]).issubset({"files", "systemd"})
            for key in ("passwd", "group")
        )
    except OSError:
        return False


def private_group_members(gid: int) -> tuple[int, ...] | None:
    state = _inspection.get()
    if state is None:
        return _private_group_members(gid)
    if gid not in state.groups:
        state.groups[gid] = _private_group_members(gid)
    return state.groups[gid]


def _private_group_members(gid: int) -> tuple[int, ...] | None:
    # Import only in POSIX leaves so Windows dispatch does not need Unix account modules.
    import grp
    import pwd

    if not accounts_enumerable():
        return None
    try:
        group = grp.getgrgid(gid)
        users = pwd.getpwall()
        groups = grp.getgrall()
        if group not in groups or len({u.pw_name for u in users}) != len(users):
            return None
        # Primary-GID users do not occur in gr_mem. Resolve every supplementary name too;
        # an empty gr_mem, the caller's groups, or an unresolvable user is never proof.
        members = {u.pw_uid for u in users if u.pw_gid == gid}
        for entry in groups:
            if entry.gr_gid != gid:
                continue
            for name in entry.gr_mem:
                user = pwd.getpwnam(name)
                if user not in users:
                    return None
                members.add(user.pw_uid)
        if not members or not members.issubset({os.geteuid(), os.stat("/").st_uid}):
            return None
        return tuple(sorted(members))
    except (KeyError, OSError):
        return None


def acl_other_writers(fd: int | None) -> bool:
    """An ACL mask is not proof that only the owning group can write."""
    if fd is None:
        # A stat without its pinned descriptor cannot establish ACL ownership.
        return True
    try:
        data = os.getxattr(fd, "system.posix_acl_access")
    except OSError as error:
        return error.errno not in {errno.ENODATA, errno.ENOTSUP, errno.EOPNOTSUPP}
    if len(data) < 4 or data[:4] != struct.pack("<I", 2) or (len(data) - 4) % 8:
        return True
    tags = [tag for tag, _, _ in struct.iter_unpack("<HHI", data[4:])]
    # Only the ordinary owner/group/other entries and optional mask are safe.
    return sorted(tags) not in ([1, 4, 32], [1, 4, 16, 32])


def check_permissions(
    info: os.stat_result, path: Path, *, source: bool, sticky_ancestor: bool, fd: int | None = None
) -> None:
    root_uid = os.stat("/").st_uid
    if sticky_ancestor and info.st_uid == root_uid and info.st_mode & stat.S_ISVTX:
        return
    state = _inspection.get() if source else None
    members = private_group_members(info.st_gid) if info.st_mode & 0o020 else None
    unsafe = (
        info.st_uid not in {root_uid, os.geteuid()}
        or bool(info.st_mode & 0o002)
        or (bool(info.st_mode & 0o020) and members is None)
        or (bool(info.st_mode & 0o020) and acl_other_writers(fd))
    )
    if unsafe and (state is None or not state.policy.receipt_required):
        raise StartupRefusal(
            "POSIX source refused: unsafe ownership or writable ancestor/input; use private "
            "ownership/a verified private group. On DrvFs use metadata,umask=022, or explicitly "
            "select writer-risk acceptance for source inputs only.",
            "source-permissions",
        )
    if state is not None and (info.st_mode & 0o022 or info.st_uid != os.geteuid()):
        state.exposures.add(
            Exposure(path, info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode), members, unsafe)
        )


def warn(message: str) -> None:
    if (state := _inspection.get()) is not None:
        state.warnings.add(message)


@dataclass(frozen=True)
class Mount:
    point: Path
    filesystem: str
    drvfs: bool


def mount_for(path: Path) -> Mount:
    with Path("/proc/self/mountinfo").open() as stream:
        text = stream.read(4 * 1024 * 1024 + 1)
    if len(text) > 4 * 1024 * 1024:
        raise StartupRefusal(
            "Cannot identify filesystem within mount budget", "source-budget-exceeded"
        )
    mounts: list[Mount] = []
    for line in text.splitlines():
        left, separator, right = line.partition(" - ")
        fields, details = left.split(), right.split()
        if not separator or len(fields) < 6 or len(details) < 3:
            raise StartupRefusal(
                "Cannot identify filesystem; inspect mountinfo", "unsupported-location"
            )
        point = Path(re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), fields[4]))
        if path.is_relative_to(point):
            filesystem = details[0]
            drvfs = filesystem == "drvfs" or (filesystem == "9p" and "aname=drvfs" in right)
            mounts.append(Mount(point, filesystem, drvfs))
    if not mounts:
        raise StartupRefusal("Cannot identify placement filesystem", "unsupported-location")
    return max(mounts, key=lambda mount: len(mount.point.parts))


def require_linux_state(path: Path) -> Mount:
    mount = mount_for(path)
    if mount.drvfs or mount.filesystem not in {
        "ext2",
        "ext3",
        "ext4",
        "xfs",
        "btrfs",
        "tmpfs",
        "overlay",
        "zfs",
        "f2fs",
        "ramfs",
    }:
        raise StartupRefusal(
            "Runtime, locks and SQLite require a private Linux filesystem placement; "
            "choose a directory in the Linux home, outside mounted Windows/network filesystems.",
            "runtime-unavailable",
        )
    return mount


def inspect_source_mount(path: Path) -> Mount:
    mount = mount_for(path)
    if mount.drvfs:
        warn(
            "DrvFs source: use metadata,umask=022 or explicit source writer-risk acceptance. "
            "Directories may be case-insensitive; runtime, locks and SQLite must stay on Linux."
        )
    return mount


def check_case(fd: int, names: tuple[str, ...]) -> None:
    existing = set(names)
    for name in names:
        alternative = name.swapcase()
        if name == alternative or alternative in existing:
            continue
        try:
            original = os.stat(name, dir_fd=fd, follow_symlinks=False)
            alias = os.stat(alternative, dir_fd=fd, follow_symlinks=False)
            if (original.st_dev, original.st_ino) == (alias.st_dev, alias.st_ino):
                warn(
                    "Case-insensitive source directory: actual names and exact-case "
                    "source identity "
                    "must be retained; snapshots with ambiguous names are unavailable."
                )
                return
        except FileNotFoundError:
            continue
