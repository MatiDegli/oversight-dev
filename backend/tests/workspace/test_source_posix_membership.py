"""Private-group account enumeration is bounded by inspection, not input count."""

import asyncio
import os
from collections import Counter

import pytest

from oversight.workspace import source_posix as posix
from oversight.workspace import source_posix_policy as policy
from oversight.workspace.errors import StartupRefusal

from .test_source_posix import GIT, repository
from .test_source_posix_policy import group, membership, user


def test_large_umask_tree_enumerates_accounts_once_per_phase(tmp_path, monkeypatch):
    import grp
    import pwd

    async def scenario():
        source = await repository(tmp_path)
        gid = source.root.stat().st_gid
        users = [user("caller", os.geteuid(), gid)]
        groups = [group("private", gid)]
        membership(monkeypatch, users, groups)
        counts = Counter()

        def count(name, value):
            counts[name] += 1
            return value

        monkeypatch.setattr(policy, "accounts_enumerable", lambda: count("nss", True))
        monkeypatch.setattr(pwd, "getpwall", lambda: count("passwd", users))
        monkeypatch.setattr(grp, "getgrall", lambda: count("group", groups))
        parent = source.root / "deep/nested/package"
        parent.mkdir(parents=True)
        for index in range(300):
            (parent / f"file_{index}.py").write_text(f"value = {index}\n")
        for path in (source.root, *source.root.rglob("*")):
            path.chmod(0o775 if path.is_dir() else 0o664)
        source.runtime.chmod(0o775)

        def once():
            assert counts == {"nss": 1, "passwd": 1, "group": 1}
            counts.clear()

        source = await posix.prepare_source(
            source.root,
            source.runtime,
            source.ide,
            reviewed_checkout=source.reviewed_checkout,
        )
        once()
        listing = await posix.inventory(source, git=GIT)
        assert len(listing.paths) >= 300
        once()
        selection = await posix.validate_selection(listing)
        once()
        stage = await posix.stage_source(selection, git=GIT)
        once()
        await posix.verify_stage(stage)
        once()
        users.append(user("new-writer", os.geteuid() + 10001, gid))
        with pytest.raises(StartupRefusal) as error:
            await posix.verify_stage(stage)
        assert error.value.refusal_category == "source-permissions"
        once()
        # Cleanup checks private stage ownership independently of the selected source.
        source.runtime.chmod(0o700)
        await posix.cleanup_stage(stage)

    asyncio.run(scenario())


def test_unknown_membership_cached_only_within_inspection(monkeypatch):
    calls = []
    monkeypatch.setattr(policy, "accounts_enumerable", lambda: calls.append(1) or False)
    for phase in range(2):
        with policy.inspection(policy.DEFAULT_POLICY, ()):
            for _ in range(20):
                assert policy.private_group_members(12345) is None
        assert len(calls) == phase + 1
