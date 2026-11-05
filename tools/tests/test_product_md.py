"""Product principles distinguish settings proposals from delivered authority."""

from pathlib import Path


def test_agent_settings_application_is_future_and_present_proposals_are_text_only() -> None:
    document = (Path(__file__).resolve().parents[2] / "PRODUCT.md").read_text(encoding="utf-8")
    principles = document.split("## Product Principles\n", 1)[1].split("\n## ", 1)[0]
    proposals = next(
        " ".join(paragraph.split())
        for paragraph in principles.split("\n- ")
        if "Agents can suggest" in paragraph or "agents can suggest" in paragraph
    )

    assert proposals.startswith("From a later M5 front, agents can suggest, prepare and apply")
    assert "Today an agent proposes a setting change to the maintainer in text." in proposals
    assert "within the person's grants, never widening their own authority" in proposals
