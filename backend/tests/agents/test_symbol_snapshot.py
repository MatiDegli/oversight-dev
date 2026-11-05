"""Snapshot disk work yields the loop and owns its directory through cancellation."""

import asyncio
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast
from unittest.mock import AsyncMock

import pytest

from oversight.agents import _symbols
from oversight.agents._harness import ToolError
from oversight.workspace import FileRead, ProcessResult, Tree

pytestmark = pytest.mark.anyio

EMPTY = '{"matches": [], "modules": [], "definitions": 0, "references": 0}'
SUCCESS = ProcessResult(0, EMPTY, "", False, False, 0)


class FakeTree:
    def __init__(self, root: Path, count: int = 1):
        self.root = root
        self.paths = [f"package_{number}/module.py" for number in range(count)]
        self.reads: list[str] = []

    async def list_files(self):
        return self.paths

    async def read_text(self, path):
        self.reads.append(path)
        return FileRead("def value():\n    return 1\n", "unused")


@pytest.fixture
def directories(tmp_path, monkeypatch):
    paths = []
    loop_thread = threading.get_ident()

    class Directory(TemporaryDirectory):
        def __init__(self, **kwargs):
            assert threading.get_ident() != loop_thread
            super().__init__(dir=tmp_path, **kwargs)
            paths.append(Path(self.name))

        def cleanup(self):
            assert threading.get_ident() != loop_thread
            super().cleanup()

    monkeypatch.setattr(_symbols, "TemporaryDirectory", Directory)
    return paths


async def test_thousands_of_snapshot_files_keep_the_loop_responsive(
    tmp_path, monkeypatch, directories
):
    tree = FakeTree(tmp_path, 3000)
    loop = asyncio.get_running_loop()
    loop_thread = threading.get_ident()
    mkdir, write_text = Path.mkdir, Path.write_text
    writes = []

    def checked_mkdir(path, *args, **kwargs):
        assert threading.get_ident() != loop_thread
        return mkdir(path, *args, **kwargs)

    def checked_write(path, *args, **kwargs):
        assert threading.get_ident() != loop_thread
        writes.append(path)
        return write_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", checked_mkdir)
    monkeypatch.setattr(Path, "write_text", checked_write)
    monkeypatch.setattr(_symbols, "run_process", AsyncMock(return_value=SUCCESS))
    started, stopped = asyncio.Event(), asyncio.Event()
    largest_gap = 0.0
    ticks = 0

    async def ticker():
        nonlocal largest_gap, ticks
        previous = loop.time()
        started.set()
        while not stopped.is_set():
            tick = loop.create_future()
            loop.call_soon(tick.set_result, None)
            await tick
            now = loop.time()
            largest_gap = max(largest_gap, now - previous)
            previous = now
            ticks += 1

    ticking = asyncio.create_task(ticker())
    await started.wait()
    try:
        result = await _symbols.find_symbol(cast(Tree, tree), "value", None, 50)
    finally:
        stopped.set()
        await ticking
    assert result == _symbols.SymbolResult([], [], 0, 0)
    assert tree.reads == tree.paths and len(writes) == 3000
    assert directories and all(not path.exists() for path in directories)
    assert ticks > 1
    # 250 ms tolerates shared-runner scheduling jitter while rejecting a whole-tree stall.
    # Thread assertions also catch synchronous disk work on unusually fast filesystems.
    assert largest_gap < 0.250, f"event loop stalled for {largest_gap:.3f} s"


@pytest.mark.parametrize(
    "result,message",
    [
        (ProcessResult(1, "", "", False, False, 0), "could not analyze Python"),
        (ProcessResult(0, EMPTY, "", True, False, 0), "reached its time limit"),
        (ProcessResult(0, EMPTY, "", False, True, 0), "could not analyze Python"),
        (ProcessResult(0, "invalid", "", False, False, 0), "returned unreadable results"),
    ],
)
async def test_snapshot_removed_after_worker_failure(
    tmp_path, monkeypatch, directories, result, message
):
    monkeypatch.setattr(_symbols, "run_process", AsyncMock(return_value=result))
    with pytest.raises(ToolError, match=message):
        await _symbols.find_symbol(cast(Tree, FakeTree(tmp_path)), "value", None, 50)
    assert directories and all(not path.exists() for path in directories)


async def test_snapshot_removed_after_write_failure(tmp_path, monkeypatch, directories):
    def fail(*args):
        raise OSError("snapshot write failed")

    worker = AsyncMock()
    monkeypatch.setattr(_symbols, "_write_source", fail)
    monkeypatch.setattr(_symbols, "run_process", worker)
    with pytest.raises(OSError, match="snapshot write failed"):
        await _symbols.find_symbol(cast(Tree, FakeTree(tmp_path)), "value", None, 50)
    worker.assert_not_awaited()
    assert directories and all(not path.exists() for path in directories)


async def test_snapshot_removed_after_worker_cancellation(tmp_path, monkeypatch, directories):
    entered = asyncio.Event()

    async def worker(*args, **kwargs):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(_symbols, "run_process", worker)
    pending = asyncio.create_task(
        _symbols.find_symbol(cast(Tree, FakeTree(tmp_path)), "value", None, 50)
    )
    await asyncio.wait_for(entered.wait(), 5)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert directories and all(not path.exists() for path in directories)


@pytest.mark.parametrize("stage", ["create", "mkdir", "write", "cleanup"])
async def test_cancellation_joins_snapshot_io_before_removal(tmp_path, monkeypatch, stage):
    loop = asyncio.get_running_loop()
    entered = asyncio.Event()
    release = threading.Event()
    paths = []

    def block(at):
        if at == stage:
            loop.call_soon_threadsafe(entered.set)
            assert release.wait(10), "test did not release snapshot I/O"

    class Directory(TemporaryDirectory):
        def __init__(self, **kwargs):
            super().__init__(dir=tmp_path, **kwargs)
            paths.append(Path(self.name))
            block("create")

        def cleanup(self):
            block("cleanup")
            super().cleanup()

    mkdir, write_text = Path.mkdir, Path.write_text

    def blocked_mkdir(path, *args, **kwargs):
        block("mkdir")
        return mkdir(path, *args, **kwargs)

    def blocked_write(path, *args, **kwargs):
        block("write")
        return write_text(path, *args, **kwargs)

    monkeypatch.setattr(_symbols, "TemporaryDirectory", Directory)
    monkeypatch.setattr(Path, "mkdir", blocked_mkdir)
    monkeypatch.setattr(Path, "write_text", blocked_write)
    monkeypatch.setattr(_symbols, "run_process", AsyncMock(return_value=SUCCESS))
    pending = asyncio.create_task(
        _symbols.find_symbol(cast(Tree, FakeTree(tmp_path)), "value", None, 50)
    )
    try:
        await asyncio.wait_for(entered.wait(), 5)
        for _ in range(2):
            pending.cancel()
            # FIFO callback acknowledges that cancellation reached the waiting task.
            checkpoint = asyncio.Event()
            loop.call_soon(checkpoint.set)
            await checkpoint.wait()
            assert not pending.done()
            assert paths and all(path.exists() for path in paths)
    finally:
        release.set()
        outcome = (await asyncio.gather(pending, return_exceptions=True))[0]
    assert isinstance(outcome, asyncio.CancelledError)
    assert all(not path.exists() for path in paths)
