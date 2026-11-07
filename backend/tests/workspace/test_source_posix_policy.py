"""Person-owned policy leaves: complete groups, mounted sources, names and disclosures."""

import asyncio
import os
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from oversight.workspace import source_posix as posix
from oversight.workspace import source_posix_policy as policy
from oversight.workspace.errors import StartupRefusal

from .test_source_posix import GIT, git, repository, witness


def membership(monkeypatch, users, groups):
    import grp
    import pwd

    monkeypatch.setattr(policy, "accounts_enumerable", lambda: True)
    monkeypatch.setattr(pwd, "getpwall", lambda: users)
    monkeypatch.setattr(grp, "getgrall", lambda: groups)
    monkeypatch.setattr(grp, "getgrgid", lambda gid: next(g for g in groups if g.gr_gid == gid))
    monkeypatch.setattr(pwd, "getpwnam", lambda name: next(u for u in users if u.pw_name == name))


def user(name, uid, gid):
    return SimpleNamespace(pw_name=name, pw_uid=uid, pw_gid=gid)


def group(name, gid, names=()):
    return SimpleNamespace(gr_name=name, gr_gid=gid, gr_mem=names)


@pytest.mark.parametrize(
    "kind",
    [
        "private-primary",
        "private-supplementary",
        "other-primary",
        "other-supplementary",
        "empty",
        "duplicate-gid",
        "unenumerable",
    ],
)
def test_complete_group_membership(monkeypatch, kind):
    uid, gid = os.geteuid(), 12345
    outsider = uid + 10001
    users = [user("caller", uid, gid if kind == "private-primary" else gid + 1)]
    groups = [group("private", gid, ("caller",) if kind != "empty" else ())]
    if kind == "other-primary":
        users.append(user("outsider", outsider, gid))
    elif kind in {"other-supplementary", "duplicate-gid"}:
        users.append(user("outsider", outsider, gid + 1))
        groups.append(group("also-writers", gid, ("outsider",)))
    membership(monkeypatch, users, groups)
    if kind == "unenumerable":
        monkeypatch.setattr(policy, "accounts_enumerable", lambda: False)
    expected = (uid,) if kind.startswith("private-") else None
    assert policy.private_group_members(gid) == expected


def test_private_group_umask_workflow(tmp_path, monkeypatch):
    async def scenario():
        source = await repository(tmp_path)
        gid = source.root.stat().st_gid
        membership(monkeypatch, [user("caller", os.geteuid(), gid)], [group("private", gid)])
        source.root.chmod(0o775)
        source.runtime.chmod(0o775)
        source.ide.chmod(0o775)
        (source.root / "a.py").chmod(0o664)
        (source.root / ".git").chmod(0o775)
        selected = await posix.prepare_source(
            source.root, source.runtime, source.ide, reviewed_checkout=tmp_path / "reviewed"
        )
        before = witness(selected.root)
        listing = await posix.inventory(selected, git=GIT)
        selection = await posix.validate_selection(listing)
        stage = await posix.stage_source(selection, git=GIT)
        await posix.verify_stage(stage)
        assert stage.disclosure is not None
        assert any(e.private_group_members == (os.geteuid(),) for e in stage.disclosure.exposures)
        assert not any(e.other_writers for e in stage.disclosure.exposures)
        assert not stage.disclosure.policy.receipt_required
        assert stage.root.stat().st_mode & 0o077 == 0
        assert witness(selected.root) == before
        await posix.cleanup_stage(stage)

    asyncio.run(scenario())


@pytest.mark.parametrize("placement", ["source", "runtime", "stage"])
def test_writer_acceptance_scoped_to_inputs(tmp_path, placement):
    async def scenario():
        source = await repository(tmp_path)
        selected_policy = policy.AdmissionPolicy(writer_risk_reason="Person accepts shared source")
        if placement == "runtime":
            source.runtime.chmod(0o777)
            with pytest.raises(StartupRefusal) as error:
                await posix.prepare_source(
                    source.root,
                    source.runtime,
                    source.ide,
                    reviewed_checkout=tmp_path / "reviewed",
                    policy=selected_policy,
                )
            assert error.value.refusal_category == "source-permissions"
            return
        source.root.chmod(0o777)
        (source.root / "a.py").chmod(0o666)
        with pytest.raises(StartupRefusal) as error:
            await posix.prepare_source(
                source.root, source.runtime, source.ide, reviewed_checkout=tmp_path / "reviewed"
            )
        assert error.value.refusal_category == "source-permissions"
        source = await posix.prepare_source(
            source.root,
            source.runtime,
            source.ide,
            reviewed_checkout=tmp_path / "reviewed",
            policy=selected_policy,
        )
        before = witness(source.root)
        listing = await posix.inventory(source, git=GIT)
        assert listing.warnings
        stage = await posix.stage_source(await posix.validate_selection(listing), git=GIT)
        assert stage.disclosure is not None
        assert stage.disclosure.uid == os.getuid()
        assert stage.disclosure.effective_uid == os.geteuid()
        assert stage.disclosure.is_root == (os.geteuid() == 0)
        assert stage.disclosure.policy.receipt_required
        assert stage.disclosure.policy.writer_risk_reason == selected_policy.writer_risk_reason
        assert any(e.other_writers and e.mode == 0o666 for e in stage.disclosure.exposures)
        if placement == "stage":
            stage.tree.chmod(0o777)
            with pytest.raises(StartupRefusal):
                await posix.verify_stage(stage)
            stage.tree.chmod(0o700)
        else:
            await posix.verify_stage(stage)
            assert witness(source.root) == before
        await posix.cleanup_stage(stage)

    asyncio.run(scenario())


def test_drvfs_synthetic_permissions_and_advice(tmp_path, monkeypatch):
    async def scenario():
        source = await repository(tmp_path)
        native = policy.mount_for

        def mounts(path):
            return (
                policy.Mount(source.root, "9p", True)
                if path.is_relative_to(source.root)
                else native(path)
            )

        monkeypatch.setattr(policy, "mount_for", mounts)
        source.root.chmod(0o777)
        with pytest.raises(StartupRefusal, match="metadata,umask=022"):
            await posix.prepare_source(
                source.root, source.runtime, source.ide, reviewed_checkout=tmp_path / "reviewed"
            )
        source = await posix.prepare_source(
            source.root,
            source.runtime,
            source.ide,
            reviewed_checkout=tmp_path / "reviewed",
            policy=policy.AdmissionPolicy("Person accepts DrvFs writers"),
        )
        await git(source.root, "config", "core.symlinks", "false")
        listing = await posix.inventory(source, git=GIT)
        assert any("DrvFs" in warning for warning in listing.warnings)
        stage = await posix.stage_source(await posix.validate_selection(listing), git=GIT)
        await posix.verify_stage(stage)
        assert stage.disclosure and any("DrvFs" in w for w in stage.disclosure.warnings)
        await posix.cleanup_stage(stage)

    asyncio.run(scenario())


@pytest.mark.parametrize("filesystem,drvfs", [("9p", True), ("cifs", False), ("nfs", False)])
def test_runtime_locks_and_sqlite_require_linux(tmp_path, monkeypatch, filesystem, drvfs):
    monkeypatch.setattr(policy, "mount_for", lambda path: policy.Mount(tmp_path, filesystem, drvfs))
    for path in (tmp_path, tmp_path / "ledger.lock", tmp_path / "events.sqlite"):
        with pytest.raises(StartupRefusal) as error:
            policy.require_linux_state(path)
        assert error.value.refusal_category == "runtime-unavailable"


def test_case_insensitive_warning_and_exact_names(tmp_path, monkeypatch):
    fd = os.open(tmp_path, os.O_RDONLY | os.O_DIRECTORY)
    (tmp_path / "ActualName").touch()
    real_stat = os.stat

    def insensitive(path, *args, **kwargs):
        return real_stat("ActualName" if path == "aCTUALnAME" else path, *args, **kwargs)

    try:
        with policy.inspection(policy.DEFAULT_POLICY, ()) as state:
            monkeypatch.setattr(os, "stat", insensitive)
            policy.check_case(fd, ("ActualName",))
            assert any("Case-insensitive" in w for w in state.disclosure().warnings)
        # An index spelling which aliases an actual entry cannot silently rename COPY bytes.
        with pytest.raises(StartupRefusal, match="case differs"):
            posix._representable(tmp_path, {"ActualName"}, frozenset({"ACTUALNAME"}))
    finally:
        os.close(fd)


@pytest.mark.parametrize("value", ["true", "false", "yes", "no", "1", "0", "not-a-boolean"])
def test_core_symlinks_boolean_only(tmp_path, value):
    async def scenario():
        source = await repository(tmp_path)
        await git(source.root, "config", "core.symlinks", value)
        if value == "not-a-boolean":
            with pytest.raises(StartupRefusal) as error:
                await posix.inventory(source, git=GIT)
            assert error.value.refusal_category == "unsafe-git-config"
        else:
            await posix.inventory(source, git=GIT)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "kind", ["missing-git", "source-budget-exceeded", "unsafe-git-config", "source-changed"]
)
def test_source_owned_categories(tmp_path, kind):
    async def scenario():
        source = await repository(tmp_path)
        executable = GIT
        if kind == "missing-git":
            executable = str(tmp_path / "missing-git")
        elif kind == "source-budget-exceeded":
            source = replace(source, budgets=replace(source.budgets, max_file=1))
        elif kind == "unsafe-git-config":
            await git(source.root, "config", "include.path", "/must-not-read")
        with pytest.raises(StartupRefusal) as error:
            listing = await posix.inventory(source, git=executable)
            if kind == "source-changed":
                (source.root / ".git/HEAD").write_text("changed")
            await posix.validate_selection(listing)
        assert error.value.refusal_category == kind

    asyncio.run(scenario())


def test_refusal_before_query_on_other_primary_writer(tmp_path, monkeypatch):
    async def scenario():
        source = await repository(tmp_path)
        gid = source.root.stat().st_gid
        membership(
            monkeypatch,
            [user("caller", os.geteuid(), gid), user("other", os.geteuid() + 10001, gid)],
            [group("writers", gid)],
        )
        source.root.chmod(0o775)
        with pytest.raises(StartupRefusal):
            await posix.prepare_source(
                source.root, source.runtime, source.ide, reviewed_checkout=tmp_path / "reviewed"
            )

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "services,expected",
    [("files systemd", True), ("files sss", False), ("compat", False), ("", False)],
)
def test_incomplete_nss_enumeration_is_not_private(tmp_path, monkeypatch, services, expected):
    config = tmp_path / "nsswitch.conf"
    config.write_text(f"passwd: {services}\ngroup: {services}\n")
    monkeypatch.setattr(policy, "Path", lambda _: config)
    assert policy.accounts_enumerable() is expected


def test_unresolvable_supplementary_member_refused(monkeypatch):
    import pwd

    uid, gid = os.geteuid(), 12345
    membership(monkeypatch, [user("caller", uid, gid)], [group("private", gid, ("unknown",))])

    def unresolved(name):
        raise KeyError(name)

    monkeypatch.setattr(pwd, "getpwnam", unresolved)
    assert policy.private_group_members(gid) is None


def test_unrepresentable_destination_cleans_only_owned_stage(tmp_path, monkeypatch):
    async def scenario():
        source = await repository(tmp_path)
        (source.root / "A.py").write_bytes(b"distinct case")
        selection = await posix.validate_selection(await posix.inventory(source, git=GIT))
        before = witness(source.root)
        create = posix._create

        def collide(path, *args, **kwargs):
            if path.name == "a.py":
                raise FileExistsError("casefold collision")
            return create(path, *args, **kwargs)

        monkeypatch.setattr(posix, "_create", collide)
        with pytest.raises(StartupRefusal, match="names collide"):
            await posix.stage_source(selection, git=GIT)
        assert not tuple(source.runtime.iterdir())
        assert witness(source.root) == before

    asyncio.run(scenario())


def test_group_membership_revalidated_before_handoff(tmp_path, monkeypatch):
    async def scenario():
        source = await repository(tmp_path)
        gid = source.root.stat().st_gid
        users = [user("caller", os.geteuid(), gid)]
        membership(monkeypatch, users, [group("private", gid)])
        (source.root / "a.py").chmod(0o664)
        selected = await posix.validate_selection(await posix.inventory(source, git=GIT))
        users.append(user("new-writer", os.geteuid() + 10001, gid))
        with pytest.raises(StartupRefusal) as error:
            await posix.stage_source(selected, git=GIT)
        assert error.value.refusal_category == "source-permissions"
        assert not tuple(source.runtime.iterdir())

    asyncio.run(scenario())


def test_mount_identity_uses_actual_filesystem_and_longest_mount(monkeypatch):
    import io

    text = (
        "1 0 8:1 / / rw - ext4 /dev/root rw\n"
        "2 1 0:2 / /mnt/c rw - 9p C: rw,aname=drvfs;path=C:\\134\n"
        "3 1 8:2 / /home/Case\\040Repo rw - ext4 /dev/native rw\n"
        "4 3 0:3 / /home/Case\\040Repo/runtime rw - 9p C: rw,aname=drvfs\n"
    )
    original = Path.open

    def mountinfo(path, *args, **kwargs):
        return (
            io.StringIO(text)
            if str(path) == "/proc/self/mountinfo"
            else original(path, *args, **kwargs)
        )

    monkeypatch.setattr(Path, "open", mountinfo)
    assert policy.mount_for(Path("/mnt/c/CaseRepo")).drvfs
    mount = policy.require_linux_state(Path("/home/Case Repo/events.sqlite"))
    assert mount.point == Path("/home/Case Repo")
    with pytest.raises(StartupRefusal) as error:
        policy.require_linux_state(Path("/home/Case Repo/runtime/ledger.lock"))
    assert error.value.refusal_category == "runtime-unavailable"


@pytest.mark.parametrize("name", [".GIT", ".GITMODULES", ".GITATTRIBUTES"])
def test_case_variant_git_controls_cannot_bypass_guards(tmp_path, name):
    async def scenario():
        source = await repository(tmp_path)
        if name == ".GIT":
            (source.root / name / "objects").mkdir(parents=True)
        else:
            (source.root / name).write_text("* filter=unsafe\n")
        with pytest.raises(OSError):
            await posix.validate_selection(await posix.inventory(source, git=GIT))
        assert not tuple(source.runtime.iterdir())

    asyncio.run(scenario())


def test_external_git_metadata_cannot_live_in_runtime(tmp_path):
    async def scenario():
        source = await repository(tmp_path)
        await git(
            source.root, "init", "-q", "--separate-git-dir=" + str(source.runtime / "metadata")
        )
        before = witness(source.root), witness(source.runtime)
        with pytest.raises(StartupRefusal) as error:
            await posix.prepare_source(
                source.root, source.runtime, source.ide, reviewed_checkout=tmp_path / "reviewed"
            )
        assert error.value.refusal_category == "runtime-unavailable"
        assert before == (witness(source.root), witness(source.runtime))

    asyncio.run(scenario())
