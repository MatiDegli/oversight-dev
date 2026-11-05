"""Owned server sessions retain independent evidence even when run ids collide."""

import asyncio
import json

import pytest
from tools.eval.ledger import Ledger
from tools.eval.report import failure_counts
from tools.eval.tasks import HERE, BenchError
from tools.eval.tests.test_arms import OFF, ON
from tools.eval.tests.test_planning import pilot
from tools.eval.tests.test_planning import (
    test_owned_fake_process_pilot_plan_and_resume_record_seed_and_order as pilot_plan_resume,
)
from tools.eval.transport import API, EVENT, Events

RUN_ID = "run-20261105-013640"


@pytest.fixture
def colliding_owned_runs(monkeypatch):
    original = asyncio.create_subprocess_exec

    async def launch(*command, **kwargs):
        if command[1:3] == ("-m", "tools.eval.server"):
            # Pin only the child factory; runtime directories, event timestamps,
            # models and the complete HTTP/SSE protocol remain real.
            command = (
                command[0],
                "-c",
                "import json, sys; import oversight.app as product; "
                f"product.new_run_id = lambda *_: {RUN_ID!r}; "
                "from tools.eval.arms import Arm; from tools.eval.server import serve; "
                "serve(Arm.model_validate(json.loads(sys.argv[1])), int(sys.argv[2]))",
                *command[3:],
            )
        return await original(*command, **kwargs)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", launch)


@pytest.mark.anyio
async def test_owned_sessions_with_same_run_id_settle_and_keep_separate_evidence(
    tmp_path, colliding_owned_runs
):
    # Keep every assertion of the original pilot/plan/resume integration test.
    await pilot_plan_resume(tmp_path)
    records = json.loads((tmp_path / "ledger.json").read_text())["records"]
    assert len(records) == 4
    assert all(r["status"] == "finished" and r["run_id"] == RUN_ID for r in records)
    paths = list(tmp_path.glob("events-*.jsonl"))
    assert len(paths) == 4
    for path in paths:
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        events = [EVENT.validate_python(row["event"]) for row in rows]
        assert all(row["run_id"] == RUN_ID for row in rows)
        assert [event.seq for event in events] == list(range(1, len(events) + 1))
        assert sum(event.type == "run.started" for event in events) == 1
    runs = json.loads((tmp_path / "manifest.json").read_text())["runs"]
    assert len(runs) == 4
    assert {tmp_path / run["raw_events"] for run in runs.values()} == set(paths)
    assert all(run["run_started"]["run_id"] == RUN_ID for run in runs.values())


@pytest.mark.anyio
@pytest.mark.parametrize("tamper", [False, True], ids=["same-event", "changed-event"])
async def test_reopening_same_server_evidence_preserves_deduplication_and_conflict_check(
    tmp_path, tamper
):
    raw = (HERE.parents[1] / "fixtures/events/handwritten-level1.jsonl").read_text().splitlines()[0]
    event = EVENT.validate_json(raw)
    assert event.type == "run.started"
    api = API("http://127.0.0.1:1")
    path = tmp_path / "events.jsonl"
    events = Events(api, event.payload.run_id, path)
    try:
        assert events.accept(raw, "1") is not None
        original = path.read_bytes()
        await events.close()
        events = Events(api, event.payload.run_id, path)
        if tamper:
            changed = json.loads(raw)
            changed["payload"]["prompt_version"] = "tampered"
            with pytest.raises(BenchError, match="event differs from durable evidence"):
                events.accept(json.dumps(changed), "1")
        else:
            assert events.accept(raw, "1") == event
            assert events.accept(raw, "1") is None
        assert path.read_bytes() == original
    finally:
        await events.close()
        await api.client.aclose()


@pytest.mark.parametrize("legacy", [False, True], ids=["scoped-only", "legacy-also-present"])
def test_report_uses_each_attempts_manifest_evidence_when_run_and_agent_ids_collide(
    tmp_path, legacy
):
    ledger = Ledger(tmp_path / "results.jsonl", 1, None)
    try:
        runs = {}
        for arm, tool in [(OFF, "list_files"), (ON, "find_symbol")]:
            record = pilot(ledger, arm)
            record.agent_id = "agent-1"
            filename = f"events-{record.run_id}-{arm.arm_id}.jsonl"
            rows = [
                {
                    "run_id": record.run_id,
                    "event": {
                        "type": "agent.step",
                        "payload": {"agent_id": record.agent_id, "tool": tool, "result": "ok"},
                    },
                }
            ]
            (tmp_path / filename).write_text(json.dumps(rows[0]) + "\n")
            runs[arm.arm_id] = {
                "run_started": {"run_id": record.run_id},
                "experiment": {
                    "arm_id": record.arm_id,
                    "repetition": record.repetition,
                    "config_hash": record.config_hash,
                },
                "task_hashes": {record.task_id: record.task_hash},
                "raw_events": filename,
            }
        if legacy:
            (tmp_path / "events-pilot.jsonl").write_text(json.dumps(rows[0]) + "\n")
        (tmp_path / "manifest.json").write_text(json.dumps({"runs": runs}))
        for record, tool in zip(ledger.state.records, ["list_files", "find_symbol"], strict=True):
            assert failure_counts(ledger, record)["tool_calls"] == {tool: {"ok": 1, "error": 0}}
    finally:
        ledger.close()


@pytest.mark.parametrize("referenced", [False, True], ids=["legacy-name", "legacy-manifest"])
def test_report_keeps_reading_existing_unambiguous_evidence(tmp_path, referenced):
    ledger = Ledger(tmp_path / "results.jsonl", 1, None)
    try:
        record = pilot(ledger)
        record.agent_id = "agent-1"
        name = "retained-events.jsonl" if referenced else f"events-{record.run_id}.jsonl"
        row = {
            "run_id": record.run_id,
            "event": {
                "type": "agent.step",
                "payload": {"agent_id": record.agent_id, "tool": "list_files", "result": "ok"},
            },
        }
        (tmp_path / name).write_text(json.dumps(row) + "\n")
        if referenced:
            (tmp_path / "manifest.json").write_text(
                json.dumps({"runs": {record.run_id: {"raw_events": name}}})
            )
        assert failure_counts(ledger, record)["tool_calls"] == {"list_files": {"ok": 1, "error": 0}}
    finally:
        ledger.close()


def test_report_refuses_legacy_evidence_with_ambiguous_run_and_agent_ids(tmp_path):
    ledger = Ledger(tmp_path / "results.jsonl", 1, None)
    try:
        first, second = pilot(ledger), pilot(ledger, ON)
        first.agent_id = second.agent_id = "agent-1"
        name = f"events-{second.run_id}.jsonl"
        (tmp_path / name).write_text(
            json.dumps(
                {
                    "run_id": second.run_id,
                    "event": {
                        "type": "agent.step",
                        "payload": {"agent_id": "agent-1", "tool": "find_symbol", "result": "ok"},
                    },
                }
            )
            + "\n"
        )
        # Old manifests retained only the last advertisement for a colliding run id.
        (tmp_path / "manifest.json").write_text(
            json.dumps(
                {
                    "runs": {
                        second.run_id: {
                            "run_started": {"run_id": second.run_id},
                            "experiment": {
                                "arm_id": second.arm_id,
                                "repetition": second.repetition,
                                "config_hash": second.config_hash,
                            },
                            "task_hashes": {second.task_id: second.task_hash},
                            "raw_events": name,
                        }
                    }
                }
            )
        )
        assert failure_counts(ledger, first) == {"evidence": "not available"}
        assert failure_counts(ledger, second) == {"evidence": "not available"}
    finally:
        ledger.close()
