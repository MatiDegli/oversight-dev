"""CI-only pytest partition by file; SHA-256 is stable across workers and Python seeds.

Selection uses the live collection rather than a file inventory, so new files need no entry.
On ab9e1d18, two shards collect 7,125/6,930 tests from 275/270 files (50.7%/49.3%).
No per-file timings are available; JUnit evidence in both workflows records future durations.
"""

import hashlib
import re

import pytest


def parse_shard(value: str) -> tuple[int, int]:
    """Accept a one-based shard index and count, refusing malformed/empty selections."""
    if re.fullmatch(r"[1-9][0-9]*/[1-9][0-9]*", value) is None:
        raise pytest.UsageError("--python-shard must be INDEX/TOTAL (1 <= INDEX <= TOTAL)")
    index, total = map(int, value.split("/"))
    if index > total:
        raise pytest.UsageError("--python-shard must be INDEX/TOTAL (1 <= INDEX <= TOTAL)")
    return index, total


def shard_for_file(path: str, total: int) -> int:
    """Assign every collection-relative POSIX file path to exactly one one-based shard."""
    if total < 1:
        raise ValueError("shard count must be positive")
    return int.from_bytes(hashlib.sha256(path.encode("utf-8")).digest(), "big") % total + 1


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--python-shard", type=parse_shard, help="CI file shard INDEX/TOTAL")


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    shard: tuple[int, int] | None = config.getoption("python_shard")
    if shard is None:
        return
    index, total = shard
    selected: list[pytest.Item] = []
    deselected: list[pytest.Item] = []
    for item in items:
        # nodeid uses root-relative POSIX paths, including under xdist and collect-only.
        destination = shard_for_file(item.nodeid.split("::", 1)[0], total)
        (selected if destination == index else deselected).append(item)
    items[:] = selected
    config.hook.pytest_deselected(items=deselected)
