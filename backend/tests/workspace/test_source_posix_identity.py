"""Running-source refusal precedes every Git query, including shared worktrees."""

import asyncio
from dataclasses import replace
from pathlib import Path

import pytest

from oversight.workspace import source_posix as posix
from oversight.workspace import source_posix_git as control
from oversight.workspace import source_posix_identity as identities
from oversight.workspace.errors import StartupRefusal
from oversight.workspace.source import OVERSIGHT_SELF

from .test_source_posix import GIT, git, repository


@pytest.mark.parametrize("selection", ["checkout", "linked"])
def test_reviewed_checkout_at_base_refused_with_repository_runtime(tmp_path, selection):
    async def scenario():
        selected = await repository(tmp_path)
        base = tmp_path / "base"
        reviewed = OVERSIGHT_SELF.checkout(base)
        reviewed.parent.mkdir(parents=True)
        await git(selected.root, "clone", "-q", str(selected.root), str(reviewed))
        chosen = reviewed
        if selection == "linked":
            chosen = tmp_path / "reviewed-worktree"
            await git(reviewed, "worktree", "add", "--detach", str(chosen))
        runtime = base / "sources" / ("a" * 64) / ".runtime"
        runtime.mkdir(parents=True)
        with pytest.raises(StartupRefusal) as error:
            await posix.prepare_source(chosen, runtime, selected.ide, reviewed_checkout=reviewed)
        assert error.value.refusal_category == "running-oversight-source"

    asyncio.run(scenario())


def test_reviewed_checkout_created_after_prepare_rechecked_before_query(tmp_path):
    async def scenario():
        selected = await repository(tmp_path)
        reviewed = selected.reviewed_checkout
        assert not reviewed.exists()
        await git(selected.root, "worktree", "add", "--detach", str(reviewed))

        async def spawn(*args, **kwargs):
            raise AssertionError("reviewed-source identity reached a Git query")

        with pytest.raises(StartupRefusal) as error:
            await posix.inventory(selected, git=GIT, spawn=spawn)
        assert error.value.refusal_category == "running-oversight-source"

    asyncio.run(scenario())


@pytest.mark.parametrize("selection", ["main", "linked", "sibling"])
@pytest.mark.parametrize("running", ["main", "linked"])
def test_every_development_worktree_refused(tmp_path, selection, running):
    async def scenario():
        original = await repository(tmp_path)
        linked, sibling = tmp_path / "linked", tmp_path / "sibling"
        await git(original.root, "worktree", "add", "--detach", str(linked))
        await git(original.root, "worktree", "add", "--detach", str(sibling))
        roots = {"main": original.root, "linked": linked, "sibling": sibling}
        with pytest.raises(StartupRefusal) as error:
            await posix.prepare_source(
                roots[selection],
                original.runtime,
                roots[running],
                reviewed_checkout=tmp_path / "reviewed",
            )
        assert error.value.refusal_category == "running-oversight-source"
        assert not tuple(original.runtime.iterdir())

    asyncio.run(scenario())


def test_common_directory_inode_alias_refused(tmp_path, monkeypatch):
    async def scenario():
        selected = await repository(tmp_path)
        other = tmp_path / "other"
        other.mkdir()
        await git(other, "init", "-q", "--template=")
        inspect = control.inspect_layout

        def alias(root, deadline):
            layout = inspect(root, deadline)
            if root == other:
                common = inspect(selected.root, deadline).directories[-1]
                return replace(layout, directories=(*layout.directories[:-1], common))
            return layout

        monkeypatch.setattr(identities, "inspect_layout", alias)
        with pytest.raises(StartupRefusal) as error:
            await posix.prepare_source(
                selected.root, selected.runtime, other, reviewed_checkout=tmp_path / "reviewed"
            )
        assert error.value.refusal_category == "running-oversight-source"

    asyncio.run(scenario())


def test_new_common_identity_checked_before_queries(tmp_path):
    async def scenario():
        selected = await repository(tmp_path)
        await git(selected.ide, "init", "-q", "--template=")
        prepared = await posix.prepare_source(
            selected.root, selected.runtime, selected.ide, reviewed_checkout=tmp_path / "reviewed"
        )
        held = tmp_path / "held-git"
        (selected.root / ".git").rename(held)
        linked = tmp_path / "linked"
        # A later source marker aimed at the running checkout cannot get to Git inspection.
        (selected.ide / "fixture").write_text("fixture")
        await git(selected.ide, "add", ".")
        await git(selected.ide, "commit", "-qm", "Fixture")
        await git(selected.ide, "worktree", "add", "--detach", str(linked))
        (selected.root / ".git").write_bytes((linked / ".git").read_bytes())

        async def spawn(*args, **kwargs):
            raise AssertionError("changed running identity reached Git")

        with pytest.raises(OSError):
            await posix.inventory(prepared, git=GIT, spawn=spawn)

    asyncio.run(scenario())


def test_reviewed_application_and_shared_worktree_refused(tmp_path):
    async def scenario():
        selected = await repository(tmp_path)
        reviewed = tmp_path / "reviewed"
        await git(selected.root, "worktree", "add", "--detach", str(reviewed))
        with pytest.raises(StartupRefusal) as error:
            await posix.prepare_source(
                selected.root,
                selected.runtime,
                selected.ide,
                reviewed_checkout=tmp_path / "reviewed",
                excluded=(reviewed,),
            )
        assert error.value.refusal_category == "running-oversight-source"

    asyncio.run(scenario())


def test_package_checkout_refused_even_with_other_ide(tmp_path):
    package_root = Path(identities.__file__).resolve().parents[4]

    async def scenario():
        selected = await repository(tmp_path)
        with pytest.raises(StartupRefusal) as error:
            await posix.prepare_source(
                package_root,
                selected.runtime,
                selected.ide,
                reviewed_checkout=tmp_path / "reviewed",
            )
        assert error.value.refusal_category == "running-oversight-source"

    asyncio.run(scenario())
