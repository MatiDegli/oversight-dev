"""Descriptor snapshots detect leaks without depending on unrelated closes."""

import os
import re
import socket
import sys
from collections import Counter
from contextlib import ExitStack
from pathlib import Path

import pytest

from oversight.workspace.isolation import open_pidfd

from .preview_boundary_support import fd_snapshot
from .preview_connector_support import assert_no_new_descriptors, fd_table, new_descriptors

pytestmark = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="/proc/self/fd")


@pytest.mark.parametrize("snapshot", [fd_table, fd_snapshot])
def test_own_status_read_during_diff_is_ignored(snapshot) -> None:
    before = snapshot()
    baseline = fd_table()
    with open("/proc/self/status") as status:
        assert os.readlink(f"/proc/self/fd/{status.fileno()}") == f"/proc/{os.getpid()}/status"
        assert snapshot() == before
        assert_no_new_descriptors(baseline)


@pytest.mark.parametrize("snapshot", [fd_table, fd_snapshot])
@pytest.mark.parametrize("kind", ["file", "socket", "own-stat", "other-status"])
def test_other_descriptors_still_fail(snapshot, kind: str, tmp_path: Path) -> None:
    before = snapshot()
    baseline = fd_table()
    with ExitStack() as stack:
        # Keep memwatch's read open too: ignoring it must not hide a real leak.
        stack.enter_context(open("/proc/self/status"))
        if kind == "socket":
            leaked = stack.enter_context(socket.socket())
        else:
            path = {
                "file": tmp_path / "leaked.txt",
                "own-stat": Path("/proc/self/stat"),
                "other-status": Path(f"/proc/{os.getppid()}/status"),
            }[kind]
            leaked = stack.enter_context(path.open("w" if kind == "file" else "r"))
        target = os.readlink(f"/proc/self/fd/{leaked.fileno()}")
        assert snapshot() - before
        assert new_descriptors(baseline) == Counter({target: 1})
        with pytest.raises(AssertionError, match=re.escape(target)):
            assert_no_new_descriptors(baseline)
    assert_no_new_descriptors(baseline)


def test_pipe_leak_is_reported_until_both_ends_close() -> None:
    before = fd_table()
    read_fd, write_fd = os.pipe()
    try:
        with pytest.raises(AssertionError, match="pipe:"):
            assert_no_new_descriptors(before)
    finally:
        os.close(read_fd)
        os.close(write_fd)
    assert_no_new_descriptors(before)


def test_closing_a_preexisting_pipe_is_not_a_leak() -> None:
    read_fd, write_fd = os.pipe()
    try:
        before = fd_table()
    finally:
        os.close(read_fd)
        os.close(write_fd)
    assert_no_new_descriptors(before)


def test_pidfd_dup_leak_is_counted_by_target() -> None:
    pidfd = open_pidfd(os.getpid())
    try:
        before = fd_table()
        duplicate = os.dup(pidfd)
        try:
            assert new_descriptors(before) == Counter({"anon_inode:[pidfd]": 1})
            with pytest.raises(AssertionError, match=re.escape("anon_inode:[pidfd]")):
                assert_no_new_descriptors(before)
        finally:
            os.close(duplicate)
    finally:
        os.close(pidfd)
    assert_no_new_descriptors(before)


def test_an_unrelated_close_cannot_cancel_a_pipe_leak() -> None:
    with open(os.devnull) as existing:
        before = fd_table()
        read_fd, write_fd = os.pipe()
        try:
            target = os.readlink(f"/proc/self/fd/{read_fd}")
            os.close(write_fd)
            existing.close()
            assert new_descriptors(before) == Counter({target: 1})
            with pytest.raises(AssertionError, match=re.escape(target)):
                assert_no_new_descriptors(before)
        finally:
            os.close(read_fd)
    assert_no_new_descriptors(before)
