"""Keep repository trust separate from the documented secrets boundary."""

from pathlib import Path


def test_trust_decision_is_not_duplicated_in_secret_boundary() -> None:
    decisions = (Path(__file__).resolve().parents[2] / "DECISIONS.md").read_text()
    trust = decisions.split("## 2026-11-05 — Allow explicit repository trust", 1)[1].split(
        "\n## ", 1
    )[0]
    secrets = decisions.split("## 2026-11-06 — Mask tested-tree secrets", 1)[1].split("\n## ", 1)[0]
    assert "The maintainer chose per-repository trust" in trust
    assert "The maintainer chose per-repository trust" not in secrets
