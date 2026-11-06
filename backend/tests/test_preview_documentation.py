"""The maintainer's exact policy supersedes older text without claiming deferred isolation."""

from pathlib import Path

import pytest

SOURCE_POLICY = (
    "Product agents use disposable worktrees under .runtime/worktrees/; nested agents use "
    ".runtime/previews/<id>/state/worktrees/. Sources are demo-repo, a pinned profile or the "
    "person\u2019s selected repository. Agents never work in development worktrees of the running "
    "Oversight or in the selected original."
)
TEST_POLICY = (
    "run_tests uses a fixed startup test specification. Demo and source profiles use "
    "Oversight\u2019s "
    "prepared demo-venv or an explicitly supplied equivalent; own repositories use their validated "
    "environment. Project imports map to the disposable tested tree. Profiles declare their test "
    "scope; own repositories retain whole-repository discovery. The person owns own-repository "
    "test timeouts; the model never changes the specification or timeout."
)
PREVIEW_POLICY = (
    "Preview launch selection is person override, then the original source\u2019s "
    "validated declaration, "
    "then supported startup detection. The demo shop uses Oversight's trusted adapter. Invalid "
    "explicit inputs refuse without fallback. The person sees commands, reason, limits and "
    "platform trust before execution. The specification stays fixed; the model can edit code it "
    "executes. Preview uses disposable tested inputs, platform-specific ownership and verified "
    "cleanup. On Linux, the verified namespace/allowlisted-root boundary covers only the "
    "reviewed-app preview\u2019s build, startup and descendants. Separate run_tests "
    "and shop-adapter "
    "launches retain network/PID isolation without filesystem isolation. Native Windows runs "
    "trusted code as the person without credential isolation."
)
WARNING = (
    "Native Windows: trusted repository code, same-user execution; original credentials and "
    "parent API remain accessible; no no-key/no-paid-call guarantee."
)


def test_preview_documentation_matches_authorized_scope():
    root = Path(__file__).resolve().parents[2]
    instructions = (root / "AGENTS.md").read_text()
    for paragraph in (SOURCE_POLICY, TEST_POLICY, PREVIEW_POLICY):
        assert paragraph in instructions
    decisions = (
        (root / "DECISIONS.md")
        .read_text()
        .split(
            "## 2026-11-03 — Reviewed self-profile, launch declaration and startup disclosure\n", 1
        )[1]
    )
    assert WARNING in decisions
    flattened = " ".join(decisions.split())
    for phrase in (
        "supersedes conflicting older selection",
        "trusted repositories only",
        "No paid-run authorization",
        "Health.preview_startup is approved for the next free minor",
        "assigns no version",
        "leaves Health/contracts untouched",
        "Consumer rendering acceptance remains pending",
        "Actual builds, nested execution, dependency installation, Linux filesystem boundary, "
        "gateway and nesting supervisor are not delivered",
        "namespace-only network/PID isolation without filesystem isolation",
        "Origin-less HTTP writes remain allowed",
        "Linux own-source work starts after this change",
        "alongside boundary/gateway/nesting work",
        "general declarations follow submission",
        "Reviewed-app execution remains unavailable",
        "Nondismissible “Preview startup”",
        "textContent, JSON.parse, strict validation and text nodes only",
    ):
        assert phrase in flattened
    assert "Reviewed self-profile front (2026-11-03)" in (root / "DEVLOG.md").read_text()


def test_roadmap_original_repository_integration_requires_person_authority():
    root = Path(__file__).resolve().parents[2]
    roadmap = (root / "docs/roadmap.md").read_text()
    session = next(line for line in roadmap.splitlines() if line.startswith("- The session design"))

    assert (
        "Guarded integration (a pointer click with no shortcut, or rules under its own standing "
        "grant, off by default and revocable; `docs/own-repository.md:27-31`) replaces required "
        "manual export"
    ) in session
    assert "export, following external commits and recovery retry become configurable" in session
    assert "available from M1" in session
    assert "Automatic integration" not in session
    assert "remain configurable" not in session


def test_product_settings_do_not_loosen_development_rules():
    root = Path(__file__).resolve().parents[2]
    instructions = (root / "AGENTS.md").read_text()
    settings = instructions.split("## Product criteria and person-owned settings\n", 1)[1]
    settings = " ".join(settings.split("## Hard rules", 1)[0].split())

    assert (
        "This governs product settings; this file's development rules (hooks, gates, review, "
        "contracts, the freeze, fake-only checks) stay fixed."
    ) in settings
    assert len(instructions.splitlines()) < 120


def test_product_settings_proposal_checks_stay_in_authorized_reader() -> None:
    root = Path(__file__).resolve().parents[2]
    assert not (root / "tools/tests/test_product_md.py").exists(), (
        "PRODUCT.md regression checks belong in the authorized preview documentation reader"
    )


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


@pytest.mark.parametrize(
    "policy",
    [
        "AGENTS.md holds only durable rules for the current state; exclude milestone identifiers, "
        "status dates and transition language",
        "Plans go to docs/roadmap.md, status and inventory to docs/additions.md, decisions and "
        "their history to DECISIONS.md and CHANGELOG.md",
        "docs/roadmap.md plans product changes; a front that changes a rule edits it here",
        "Approve has no keyboard shortcut, not even Ctrl+Enter",
        "combined tests run first on the combined result",
        "Agents never widen their own or another agent's authority",
        "an agent proposes a setting change to the maintainer in text",
        "typing-extensions under PSF-2.0",
        "CPython under PSF-2.0 for the Windows installer only",
        "The public submission repository stays frozen until the maintainer lifts it "
        "(no pushes or activity there); development pushes go to the development mirror",
        "never the product's credits",
        "Hooks always run, never --no-verify",
        "only the coordinator's landing step may skip the pre-push make check, and only for the "
        "exact tree whose full verification just passed",
        "One front per agent: one cohesive change, one worktree and branch, small PRs with tests",
        "Only the reviewer may defer a SHOULD-FIX outside security, authority, lifecycle, gates, "
        "contracts and the event log, saying why it is harmless; it becomes a follow-up",
        "How the maintainer and their agents actually work, or better",
        "Platform status and acceptance: docs/additions.md",
    ],
)
def test_current_agent_rules_record_coordinator_ruling(policy: str):
    instructions = (Path(__file__).resolve().parents[2] / "AGENTS.md").read_text()
    assert policy in " ".join(instructions.split())


def test_agent_rules_are_compact_and_contain_no_milestone_transitions():
    instructions = (Path(__file__).resolve().parents[2] / "AGENTS.md").read_text()
    assert len(instructions.splitlines()) <= 90
    for obsolete in (
        *(f"M{number}" for number in range(1, 10)),
        "The new-since-kickoff requirement ends",
        "demo path",
        "harmless before submission",
        "docs/proposal.md, section 7",
        "maintainer and his",
    ):
        assert obsolete not in instructions
    assert instructions.count("cross-provider review") == 1
    mechanism = [line for line in instructions.splitlines() if line.startswith("Agents never")]
    assert len(mechanism) == 1
    assert 'DECISIONS.md "Agents can suggest, prepare and apply settings"' in mechanism[0]


def test_agent_rules_define_each_role_and_preserve_current_trust_disclosure():
    instructions = (Path(__file__).resolve().parents[2] / "AGENTS.md").read_text()
    roles = instructions.split("## Roles\n", 1)[1].split("\n\n", 1)[0].splitlines()
    assert len(roles) == 3
    assert "coordinator plans, briefs, integrates and alone merges" in roles[0]
    assert "worker changes one front in its own worktree" in roles[1]
    assert "what changed, what was verified and how" in roles[1]
    assert "reviewers and researchers are read-only" in roles[2].lower()
    assert "path:line or command output" in roles[2]
    assert "The repository trust prompt is informational" in instructions
    assert "it grants no execution authority" in instructions
    assert "The reviewed self application is refused at admission and execution" in instructions
    assert "Admission requires an explicit no-key entry, distinct ports and final acceptance" in (
        instructions
    )
