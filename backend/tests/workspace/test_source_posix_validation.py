"""Validation witnesses shared ancestors once and rechecks them before handoff."""

import asyncio
import os
from collections import Counter
from contextlib import contextmanager

import pytest

from oversight.workspace import source_posix as posix
from oversight.workspace import source_posix_io as posix_io
from oversight.workspace import source_posix_policy as policy
from oversight.workspace.errors import SourceChanged
from oversight.workspace.source_posix_io import entry

from .test_source_posix import GIT, repository


@pytest.mark.parametrize("files", [3, 300])
def test_validation_witnesses_each_ancestor_once_per_phase(tmp_path, monkeypatch, files):
    async def scenario():
        source = await repository(tmp_path)
        parent = source.root / "deep/nested/package"
        parent.mkdir(parents=True)
        for index in range(files):
            (parent / f"file_{index}.py").write_text(f"value = {index}\n")
        expected = {source.root, parent.parent.parent, parent.parent, parent}
        counts = Counter()
        directory = posix.directory

        @contextmanager
        def counted(path):
            counts[path] += 1
            with directory(path) as fd:
                yield fd

        monkeypatch.setattr(posix, "directory", counted)
        for _ in range(2):
            listing = await posix.inventory(source, git=GIT)
            counts.clear()
            selection = await posix.validate_selection(listing)
            assert {w.path for w in selection.directories} == expected
            assert len(selection.entries) == files + 2
            # One initial witness plus the final check, independent of file count.
            assert counts == dict.fromkeys(expected, 2)

    asyncio.run(scenario())


@pytest.mark.parametrize("protected", [False, True])
def test_directory_classifies_target_once_and_checks_every_ancestor(
    tmp_path, monkeypatch, protected
):
    tree = tmp_path / "deep/nested/package"
    tree.mkdir(parents=True)
    classifications = []
    permissions = []
    source_input = policy.source_input
    secure = posix_io.secure

    def classify(path):
        classifications.append(path)
        return source_input(path)

    def check(info, **kwargs):
        permissions.append(kwargs["source"])
        secure(info, **kwargs)

    monkeypatch.setattr(posix_io, "source_input", classify)
    monkeypatch.setattr(posix_io, "secure", check)
    with (
        policy.inspection(policy.DEFAULT_POLICY, (tmp_path,) if protected else ()),
        posix_io.directory(tree),
    ):
        pass
    assert classifications == [tree]
    assert permissions == [not protected] * len(tree.parts)


def test_validation_retains_first_ancestor_stamp(tmp_path, monkeypatch):
    async def scenario():
        source = await repository(tmp_path)
        parent = source.root / "package"
        parent.mkdir()
        for name in ("a.py", "b.py"):
            (parent / name).write_text("value = 1\n")
        listing = await posix.inventory(source, git=GIT)
        changed = False

        def mutate(root, name, deadline, **kwargs):
            nonlocal changed
            item = entry(root, name, deadline, **kwargs)
            if name.startswith("package/") and not changed:
                stamp = parent.stat()
                os.utime(parent, ns=(stamp.st_atime_ns, stamp.st_mtime_ns + 1))
                changed = True
            return item

        monkeypatch.setattr(posix, "entry", mutate)
        with pytest.raises(SourceChanged, match="source directory changed"):
            await posix.validate_selection(listing)
        assert changed

    asyncio.run(scenario())
