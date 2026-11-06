"""A real failing subprocess reaches only the scripted model, with its secret masked."""

import pytest
from agent_helpers import Recorder, make_run, script
from secret_fixtures import CANARY, COMMIT, TEST_ID, install_failure

from oversight.workspace import Tree, Workspace

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("harness_pack", [False, True])
@pytest.mark.parametrize("name", ["PRIVATE_VALUE", "DB_PASS", "MYSQL_PWD", "GPG_PASSPHRASE"])
async def test_run_tests_observation_masks_dotenv_and_preserves_debugging_evidence(
    small_tree: tuple[Workspace, Tree], harness_pack: bool, name: str
) -> None:
    workspace, tree = small_tree
    await install_failure(tree)
    secret = await tree.read_text(".env")
    await tree.write_text(".env", f"{name}={CANARY}\n", expected_hash=secret.hash)
    model = script([("run_tests", {})], [("finish", {"summary": "Report the failing test."})])
    recorder = Recorder()
    await make_run(small_tree, model, recorder, harness_pack=harness_pack).run()
    [observation] = [m["content"] for m in model.requests[1] if m["role"] == "tool"]
    assert CANARY not in str(observation)
    assert "[redacted] masks known secret" in str(observation)
    assert COMMIT in str(observation) and TEST_ID in str(observation)
    assert "pytest.fail(value)" in str(observation)
    assert str(workspace.runtime_root) not in str(observation)
    [suite] = recorder.suites
    [case] = [c for c in suite.cases if c.test_id == TEST_ID]
    assert case.detail == "Failed: [redacted]"
