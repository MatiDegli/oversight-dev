"""Real Git layouts and bounded control witnesses, without public admission wiring."""

import asyncio
import os
import time
from dataclasses import replace
from pathlib import Path
from posixpath import relpath

import pytest

from oversight.workspace import source_posix as posix
from oversight.workspace import source_posix_git as control
from oversight.workspace import source_posix_io as io
from oversight.workspace.runner import run_process

from .test_source_posix import GIT, git, repository, witness


@pytest.mark.parametrize(
    "kind", ["main", "linked", "detached", "relative", "shallow", "local", "separate"]
)
def test_layout_copy_handoff(tmp_path, kind):
    async def scenario():
        original = await repository(tmp_path)
        root = original.root
        if kind in {"main", "linked", "detached", "relative"}:
            linked = tmp_path / "linked"
            await git(root, "worktree", "add", "--detach", str(linked))
            if kind != "main":
                root = linked
                if kind == "linked":
                    await git(root, "switch", "-c", "linked-branch")
                if kind == "relative":
                    marker = root / ".git"
                    pointer = marker.read_text().removeprefix("gitdir: ").strip()
                    marker.write_text("gitdir: " + relpath(pointer, root) + "\n")
            await git(root, "config", "extensions.worktreeConfig", "true")
            await git(root, "config", "--worktree", "core.filemode", "true")
        elif kind == "separate":
            separate = tmp_path / "separate"
            await git(tmp_path, "clone", "-q", str(root), str(separate))
            await git(separate, "init", "-q", "--separate-git-dir=" + str(tmp_path / "metadata"))
            root = separate
        else:
            clone = tmp_path / "clone"
            args = ("--depth=1", original.root.as_uri()) if kind == "shallow" else (str(root),)
            await git(tmp_path, "clone", "-q", *args, str(clone))
            if kind == "local":
                blob = await git(root, "rev-parse", "HEAD:a.py")
                assert (clone / ".git/objects" / blob[:2] / blob[2:]).stat().st_nlink > 1
            root = clone
        (root / "a.py").write_bytes(b"dirty\r\n\xff\0")
        (root / "gone.py").unlink()
        (root / "untracked").write_bytes(b"untracked\0")
        source = await posix.prepare_source(
            root, original.runtime, original.ide, reviewed_checkout=tmp_path / "reviewed"
        )
        before = witness(original.root), witness(root)
        listing = await posix.inventory(source, git=GIT)
        selection = await posix.validate_selection(listing)
        stage = await posix.stage_source(selection, git=GIT)
        await posix.verify_stage(stage)
        assert (stage.tree / "a.py").read_bytes() == b"dirty\r\n\xff\0"
        assert (stage.tree / "untracked").read_bytes() == b"untracked\0"
        assert not (stage.tree / "gone.py").exists()
        assert before == (witness(original.root), witness(root))
        await posix.cleanup_stage(stage)
        assert not tuple(source.runtime.iterdir())

    asyncio.run(scenario())


def test_objects_never_enumerated_or_hashed(tmp_path, monkeypatch):
    async def scenario():
        source = await repository(tmp_path)
        objects = source.root / ".git/objects"
        loose = objects / "ff"
        loose.mkdir(exist_ok=True)
        for number in range(posix.MAX_PATHS + 1):
            (loose / f"{number:038x}").touch()
        scan, read = os.scandir, io.read_file

        def guarded_scan(path):
            actual = (
                Path(os.readlink(f"/proc/self/fd/{path}")) if isinstance(path, int) else Path(path)
            )
            assert not actual.is_relative_to(objects), actual
            return scan(path)

        def guarded_read(path, *args, **kwargs):
            assert not path.is_relative_to(objects), path
            return read(path, *args, **kwargs)

        monkeypatch.setattr(os, "scandir", guarded_scan)
        monkeypatch.setattr(control, "read_file", guarded_read)
        listing = await posix.inventory(source, git=GIT)
        selection = await posix.validate_selection(listing)
        # Unrelated object changes do not invalidate a working-byte COPY witness.
        (loose / "unrelated").touch()
        stage = await posix.stage_source(selection, git=GIT)
        await posix.verify_stage(stage)
        await posix.cleanup_stage(stage)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "name",
    [
        "modules",
        "info/grafts",
        "objects/info/alternates",
        "objects/info/http-alternates",
        "refs/replace",
    ],
)
def test_forbidden_known_metadata_preserved(tmp_path, name):
    async def scenario():
        source = await repository(tmp_path)
        target = source.root / ".git" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.touch()
        with pytest.raises(OSError, match="forbidden Git metadata"):
            await posix.inventory(source, git=GIT)
        assert target.exists()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "name", ["index.lock", "objects/maintenance.lock", "refs/heads/stale.lock"]
)
def test_stale_lock_warning_survives_handoff(tmp_path, name):
    async def scenario():
        source = await repository(tmp_path)
        lock = source.root / ".git" / name
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_bytes(b"stale")
        listing = await posix.inventory(source, git=GIT)
        assert listing.warnings
        stage = await posix.stage_source(await posix.validate_selection(listing), git=GIT)
        await posix.verify_stage(stage)
        assert stage.selection.inventory.warnings == listing.warnings
        await posix.cleanup_stage(stage)
        assert lock.read_bytes() == b"stale"

    asyncio.run(scenario())


@pytest.mark.parametrize("continuous", [False, True])
def test_changed_witness_retry_budget(tmp_path, continuous):
    async def scenario():
        source = await repository(tmp_path)
        source = replace(source, budgets=replace(source.budgets, witness_retries=1))
        queries = 0

        async def spawn(argv, **kwargs):
            nonlocal queries
            result = await run_process(argv, **kwargs)
            if "rev-parse" in argv:
                queries += 1
                if continuous or queries == 1:
                    with (source.root / ".git/config").open("a") as stream:
                        stream.write("\n# changed\n")
            return result

        if continuous:
            with pytest.raises(OSError, match="stop other writers"):
                await posix.inventory(source, git=GIT, spawn=spawn)
        else:
            listing = await posix.inventory(source, git=GIT, spawn=spawn)
            await posix.validate_selection(listing)
        assert queries == 2
        assert not tuple(source.runtime.iterdir())

    asyncio.run(scenario())


@pytest.mark.parametrize("where", ["shared", "worktree"])
@pytest.mark.parametrize("setting", ["include.path", "core.fsmonitor", "core.worktree"])
def test_config_checked_before_repository_queries(tmp_path, where, setting):
    async def scenario():
        original = await repository(tmp_path)
        linked = tmp_path / "linked"
        await git(original.root, "worktree", "add", "--detach", str(linked))
        await git(original.root, "config", "extensions.worktreeConfig", "true")
        if where == "shared":
            target = original.root / ".git/config"
        else:
            target = (
                control.inspect_layout(linked, time.monotonic() + 10).gitdir / "config.worktree"
            )
        with target.open("a") as stream:
            stream.write(f"\n[{setting.split('.')[0]}]\n{setting.split('.')[1]} = /never/read\n")
        source = await posix.prepare_source(
            linked, original.runtime, original.ide, reviewed_checkout=tmp_path / "reviewed"
        )

        async def spawn(argv, **kwargs):
            assert "--no-includes" in argv, "unsafe config reached repository query"
            assert "GIT_DIR" not in kwargs["env"]
            return await run_process(argv, **kwargs)

        with pytest.raises(OSError):
            await posix.inventory(source, git=GIT, spawn=spawn)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "name", ["HEAD", "index", "config", "packed-refs", "shallow", "info/attributes"]
)
def test_control_mutations_invalidate_handoff(tmp_path, name):
    async def scenario():
        source = await repository(tmp_path)
        selection = await posix.validate_selection(await posix.inventory(source, git=GIT))
        path = source.root / ".git" / name
        path.parent.mkdir(exist_ok=True)
        with path.open("ab") as stream:
            stream.write(b"changed\n")
        with pytest.raises(OSError, match="Git metadata changed"):
            await posix.stage_source(selection, git=GIT)
        assert not tuple(source.runtime.iterdir())

    asyncio.run(scenario())


@pytest.mark.parametrize("pointer", ["marker", "commondir", "backlink"])
def test_git_directory_pointers_revalidated_before_queries(tmp_path, pointer):
    async def scenario():
        original = await repository(tmp_path)
        linked = tmp_path / "linked"
        await git(original.root, "worktree", "add", "--detach", str(linked))
        source = await posix.prepare_source(
            linked, original.runtime, original.ide, reviewed_checkout=tmp_path / "reviewed"
        )
        layout = control.inspect_layout(linked, time.monotonic() + 10)
        paths = {
            "marker": linked / ".git",
            "commondir": layout.gitdir / "commondir",
            "backlink": layout.gitdir / "gitdir",
        }
        path = paths[pointer]

        # Replace a pointer after the safe config listing, before any repository query.
        async def mutate_after_listing(argv, **kwargs):
            assert "--no-includes" in argv, "changed pointer reached repository query"
            result = await run_process(argv, **kwargs)
            data = path.read_bytes()
            path.unlink()
            path.write_bytes(data)
            return result

        with pytest.raises(OSError):
            await posix.inventory(source, git=GIT, spawn=mutate_after_listing)
        assert not tuple(source.runtime.iterdir())

    asyncio.run(scenario())


def test_symlink_in_pointer_parent_traversal_refused(tmp_path):
    async def scenario():
        original = await repository(tmp_path)
        linked = tmp_path / "linked"
        await git(original.root, "worktree", "add", "--detach", str(linked))
        marker = linked / ".git"
        target = Path(marker.read_text().removeprefix("gitdir: ").strip())
        alias = tmp_path / "alias"
        alias.symlink_to(target.parent, target_is_directory=True)
        marker.write_text(f"gitdir: {alias}/../{target.parent.name}/{target.name}\n")
        with pytest.raises(OSError):
            source = await posix.prepare_source(
                linked, original.runtime, original.ide, reviewed_checkout=tmp_path / "reviewed"
            )
            await posix.inventory(source, git=GIT)

    asyncio.run(scenario())


@pytest.mark.parametrize("deadline", [0, -1])
def test_expired_caller_deadline_never_restarts(tmp_path, deadline):
    async def scenario():
        source = await repository(tmp_path)

        async def no_query(*args, **kwargs):
            raise AssertionError("expired caller deadline reached Git")

        with pytest.raises(OSError, match="deadline"):
            await posix.inventory(source, git=GIT, spawn=no_query, deadline=deadline)

    asyncio.run(scenario())
