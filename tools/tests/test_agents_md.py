"""Keep agent instructions durable; route plans and status to their own documents."""

import re
from pathlib import Path

TEMPORARY_CONTENT = re.compile(
    r"\bM[0-9]+\b|\b(?:today|currently|will|planned|later)\b|"
    r"\buntil\b[^.!?]*?\blands\b|\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b",
    re.IGNORECASE,
)


def test_agents_md_contains_only_durable_rules() -> None:
    document = (Path(__file__).resolve().parents[2] / "AGENTS.md").read_text(encoding="utf-8")
    lines = document.splitlines()
    violations = []
    for match in TEMPORARY_CONTENT.finditer(document):
        number = document.count("\n", 0, match.start()) + 1
        violations.append(
            f"AGENTS.md:{number}: temporary content {match.group()!r}: {lines[number - 1].strip()}"
        )
    assert not violations, (
        "Keep AGENTS.md durable; move plans to docs/roadmap.md, status to docs/additions.md, "
        "and decision history to DECISIONS.md/CHANGELOG.md.\n" + "\n".join(violations)
    )
