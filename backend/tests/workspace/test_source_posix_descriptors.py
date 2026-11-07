"""Source cleanup checks preserve every non-exempt baseline descriptor."""

from collections import Counter
from pathlib import Path

import pytest

from . import test_source_posix as source_checks


@pytest.mark.parametrize("check", ["descriptor_closure", "runner_cleanup_witness"])
def test_source_cleanup_rejects_closed_baseline_descriptor(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, check: str
) -> None:
    baseline = source_checks.fd_baseline
    with (tmp_path / "baseline-descriptor").open("w") as existing:

        async def close_after_snapshot() -> Counter[str]:
            before = await baseline()
            existing.close()
            return before

        monkeypatch.setattr(source_checks, "fd_baseline", close_after_snapshot)
        with pytest.raises(AssertionError, match="descriptors left open"):
            if check == "descriptor_closure":
                source_checks.test_descriptor_closure(tmp_path)
            else:
                source_checks.test_real_git_runner_cleanup(tmp_path, "inventory", "timeout")
