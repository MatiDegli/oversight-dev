"""Private fixture values are absent from SQLite test evidence and fake reviewer inputs."""

import json
from dataclasses import replace

import pytest
from changes_helpers import EDIT, PATH, Harness
from secret_fixtures import CANARY, COMMIT, TEST_ID, install_failure

from oversight.agents import (
    FAKE_MODEL,
    FAKE_MODEL_B,
    ModelReply,
    Script,
    ScriptedModel,
    review_candidate,
)
from oversight.events import read_store
from oversight.runtime_review import review_inputs
from oversight_contracts.events import ChangeProposed, SuiteExecution

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("name", ["PRIVATE_VALUE", "DB_PASS", "MYSQL_PWD", "GPG_PASSPHRASE"])
async def test_tests_executed_event_masks_junit_detail_before_sqlite(h: Harness, name: str) -> None:
    tree = await h.open(1)
    await install_failure(tree)
    secret = await tree.read_text(".env")
    await tree.write_text(".env", f"{name}={CANARY}\n", expected_hash=secret.hash)
    run = await h.workspace.run_tests(tree, timeout_s=60)
    await h.manager.tests_executed("agent-1", run)
    [execution] = h.payloads(SuiteExecution)
    assert execution.suite.cases is not None
    [case] = [c for c in execution.suite.cases if c.test_id == TEST_ID]
    assert case.detail == "Failed: [redacted]"
    evidence = [e for e in read_store(h.tmp_path / "run.sqlite") if e.type == "tests.executed"]
    assert evidence and CANARY not in "".join(e.envelope for e in evidence)
    assert CANARY not in "".join(e.envelope for e in read_store(h.tmp_path / "run.sqlite"))
    assert TEST_ID in evidence[0].envelope
    assert COMMIT in run.output


async def propose_secret(h: Harness) -> ChangeProposed:
    task = replace(h.task(1), task=f"Inspect {PATH} with {CANARY}")
    tree = await h.manager.open(task, "fake")
    await tree.write_text(".env", f"PRIVATE_VALUE={CANARY}\n", expected_hash=None)
    assert await h.edit(1, *EDIT)
    assert await h.finish(1, summary=f"Checked {PATH}: {CANARY}")
    [proposal] = h.payloads(ChangeProposed)
    return proposal


async def test_reviewer_request_masks_task_and_summary(h: Harness) -> None:
    proposal = await propose_secret(h)
    capture = await h.manager.capture_review("change-1")
    client = ScriptedModel(
        Script("review", [ModelReply("VERDICT: accept", [], model=FAKE_MODEL_B.model)]),
        FAKE_MODEL_B,
    )
    outcome = await review_candidate(
        client,
        capture.target,
        review_inputs(client, proposal, await h.manager.review_diff(capture)),
        author=FAKE_MODEL,
    )
    assert outcome.review.verdict == "clean"
    request = str(client.requests[0][0]["content"])
    assert CANARY not in request
    data = json.loads(request.split("<change_data>\n")[1].split("\n</change_data>")[0])
    assert data["task"] == f"Inspect {PATH} with [redacted]"
    assert data["summary"] == f"Checked {PATH}: [redacted]"
    assert "[redacted] masks known secret" in request
    assert CANARY not in proposal.model_dump_json()


async def test_reviewer_diff_masks_secret_file_and_preserves_git_ids(h: Harness) -> None:
    await propose_secret(h)
    capture = await h.manager.capture_review("change-1")
    diff = await h.manager.review_diff(capture)
    assert CANARY not in diff
    assert "+PRIVATE_VALUE=[redacted]" in diff
    assert "diff --git a/.env b/.env" in diff and f"a/{PATH}" in diff
    assert "return 3" in diff and "index " in diff
    assert h.workspace.redact(capture.target.head_commit) == capture.target.head_commit
