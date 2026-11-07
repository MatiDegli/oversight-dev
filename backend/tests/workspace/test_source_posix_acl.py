"""ACL masks must not hide writers behind a verified private owning group."""

import asyncio
import errno
import os
import struct
import time

import pytest

from oversight.workspace import source_posix as posix
from oversight.workspace import source_posix_policy as policy
from oversight.workspace.errors import StartupRefusal

from .test_source_posix import GIT, repository
from .test_source_posix_policy import group, membership, user


def acl(*tags):
    return struct.pack("<I", 2) + b"".join(struct.pack("<HHI", tag, 7, 12345) for tag in tags)


@pytest.mark.parametrize("target", ["source", "git", "file", "runtime"])
@pytest.mark.parametrize("named_tag", [2, 8])
def test_named_acl_writers_refused_on_pinned_inputs(tmp_path, monkeypatch, target, named_tag):
    async def scenario():
        source = await repository(tmp_path)
        path = {
            "source": source.root,
            "git": source.root / ".git",
            "file": source.root / "a.py",
            "runtime": source.runtime,
        }[target]
        path.chmod(0o664 if target == "file" else 0o775)
        gid = path.stat().st_gid
        membership(monkeypatch, [user("caller", os.geteuid(), gid)], [group("private", gid)])
        pinned = path.stat()
        observed = []

        def getxattr(fd, name):
            assert isinstance(fd, int), "ACL inspection must use the no-follow pinned descriptor"
            assert name == "system.posix_acl_access"
            info = os.fstat(fd)
            if (info.st_dev, info.st_ino) == (pinned.st_dev, pinned.st_ino):
                observed.append(fd)
                return acl(1, named_tag, 4, 16, 32)
            raise OSError(errno.ENODATA, "no ACL")

        monkeypatch.setattr(os, "getxattr", getxattr)
        with pytest.raises(StartupRefusal) as error:
            prepared = await posix.prepare_source(
                source.root,
                source.runtime,
                source.ide,
                reviewed_checkout=source.reviewed_checkout,
            )
            await posix.validate_selection(await posix.inventory(prepared, git=GIT))
        assert error.value.refusal_category == "source-permissions"
        assert observed

    asyncio.run(scenario())


def test_acl_writer_risk_never_relaxes_protected_stage(tmp_path, monkeypatch):
    tree = tmp_path / "source-stage-fixture/tree"
    tree.mkdir(parents=True)
    tree.chmod(0o775)
    gid = tree.stat().st_gid
    membership(monkeypatch, [user("caller", os.geteuid(), gid)], [group("private", gid)])
    monkeypatch.setattr(os, "getxattr", lambda fd, name: acl(1, 2, 4, 16, 32))
    with (
        policy.inspection(policy.AdmissionPolicy("Person accepts source writers"), (tmp_path,)),
        pytest.raises(StartupRefusal) as error,
        posix.directory(tree),
    ):
        pass
    assert error.value.refusal_category == "source-permissions"


@pytest.mark.parametrize("data", [acl(1, 4, 16, 32), acl(1, 2, 4, 16, 32), b"malformed"])
def test_acl_writer_risk_disclosure(tmp_path, monkeypatch, data):
    path = tmp_path / "input"
    path.write_text("source")
    path.chmod(0o664)
    gid = path.stat().st_gid
    membership(monkeypatch, [user("caller", os.geteuid(), gid)], [group("private", gid)])
    monkeypatch.setattr(os, "getxattr", lambda fd, name: data)
    chosen = policy.AdmissionPolicy("Person accepts source ACL writers")
    with policy.inspection(chosen, ()) as state:
        posix.read_file(path, time.monotonic() + 10)
    exposure = next(e for e in state.disclosure().exposures if e.path == path)
    assert exposure.other_writers is (data != acl(1, 4, 16, 32))


@pytest.mark.parametrize("failure", [errno.EACCES, errno.EIO])
def test_unreadable_acl_cannot_certify_private_writers(tmp_path, monkeypatch, failure):
    path = tmp_path / "input"
    path.write_text("source")
    path.chmod(0o664)
    gid = path.stat().st_gid
    membership(monkeypatch, [user("caller", os.geteuid(), gid)], [group("private", gid)])

    def unavailable(fd, name):
        raise OSError(failure, "ACL unavailable")

    monkeypatch.setattr(os, "getxattr", unavailable)
    with pytest.raises(StartupRefusal) as error:
        posix.read_file(path, time.monotonic() + 10)
    assert error.value.refusal_category == "source-permissions"
