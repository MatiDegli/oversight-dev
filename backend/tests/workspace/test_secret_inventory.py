"""Secret inventory limits fail closed; refresh precedes parsing child diagnostics."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from secret_fixtures import CANARY, install_failure

from oversight.redaction import Redactor
from oversight.workspace import Workspace, WorkspaceError

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("mode", ["count", "size", "total", "encoding", "link"])
async def test_inventory_failure_refuses_tests_and_withholds_later_text(
    workspace: Workspace, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    root = workspace.main.root
    if mode == "count":
        for i in range(129):
            (root / f".env.{i}").write_text("VALUE=synthetic-private-material\n")
    elif mode == "size":
        (root / ".env").write_text("VALUE=" + "x" * (256 * 1024))
    elif mode == "total":
        for i in range(5):
            (root / f".env.{i}").write_text("VALUE=" + "x" * (256 * 1024 - 6))
    elif mode == "encoding":
        (root / ".env").write_bytes(b"VALUE=\xff\xfe\n")
    else:
        external = tmp_path / "external-secret"
        external.write_text("VALUE=synthetic-private-material\n")
        (root / ".env").symlink_to(external)
    runner = AsyncMock()
    monkeypatch.setattr("oversight.workspace.suite_guard.run_suite", runner)
    with pytest.raises(WorkspaceError, match="secret inventory unavailable"):
        await workspace.run_tests(workspace.main, timeout_s=5)
    runner.assert_not_awaited()
    assert workspace.redact("any subsequent diff or summary") == "[redacted]"


@pytest.mark.parametrize("relative", ["nested/.env.local", ".venv/.env.private", ".envs/settings"])
async def test_examples_are_exempt_and_keys_are_shared_across_tested_trees(
    make_workspace, relative: str
) -> None:
    workspace = make_workspace(demo_python=Path(sys.executable))
    await workspace.acquire_runtime()
    await workspace.reset()
    (workspace.main.root / ".env.example").write_text("PUBLIC=example-visible-value\n")
    target = workspace.main.root / relative
    target.parent.mkdir()
    target.write_text(f"PRIVATE={CANARY}\nSHORT=tiny\n")
    workspace.redactor = Redactor(
        "synthetic-provider-morning-key", "synthetic-provider-evening-key"
    )
    await workspace.run_tests(workspace.main, timeout_s=5)
    assert workspace.redact(CANARY) == "[redacted]"
    assert workspace.redact("morning-key evening-key tiny example-visible-value") == (
        "[redacted] [redacted] tiny example-visible-value"
    )
    other = await workspace.create_worktree("agent-1")
    await workspace.run_tests(other, timeout_s=5)
    assert workspace.redact(CANARY) == "[redacted]"


async def test_changed_dotenv_is_captured_before_stdout_and_junit(
    make_workspace,
) -> None:
    workspace = make_workspace(demo_python=Path(sys.executable))
    await workspace.acquire_runtime()
    await workspace.reset()
    tree = workspace.main
    await install_failure(tree)
    replacement = (
        "from pathlib import Path\nimport pytest\n\n"
        "def test_changed_secret():\n"
        "    old = Path('.env').read_text().split('=', 1)[1].strip()\n"
        "    new = 'twilight-' + 'oriole-9621'\n"
        "    Path('.env').write_text('VALUE=' + new)\n"
        "    pytest.fail(old + ' ' + new)\n"
    )
    target = await tree.read_text("tests/test_secret.py")
    await tree.write_text("tests/test_secret.py", replacement, expected_hash=target.hash)
    run = await workspace.run_tests(tree, timeout_s=5)
    assert CANARY not in run.output and "twilight-oriole-9621" not in run.output
    [case] = [c for c in run.cases if c.test_id.endswith("::test_changed_secret")]
    assert case.detail == "Failed: [redacted] [redacted]"


async def test_secret_parameter_ids_are_withheld_without_inventing_case_identity(
    make_workspace,
) -> None:
    workspace = make_workspace(demo_python=Path(sys.executable))
    await workspace.acquire_runtime()
    await workspace.reset()
    tree = workspace.main
    await tree.write_text(".env", f"VALUE={CANARY}\n", expected_hash=None)
    await tree.write_text(
        "tests/test_parameter.py",
        "from pathlib import Path\nimport pytest\n"
        "value = Path('.env').read_text().split('=', 1)[1].strip()\n"
        "@pytest.mark.parametrize('x', [value], ids=[value])\n"
        "def test_parameter(x):\n    pytest.fail(x)\n",
        expected_hash=None,
    )
    run = await workspace.run_tests(tree, timeout_s=5)
    assert CANARY not in run.output + run.result.model_dump_json() + str(run.cases)
    assert "secret-bearing test identifiers withheld" in run.problems
    assert all("test_parameter" not in c.test_id for c in run.cases)


async def test_invalid_inventory_after_child_cleans_reports_and_withholds_output(
    make_workspace,
) -> None:
    workspace = make_workspace(demo_python=Path(sys.executable))
    await workspace.acquire_runtime()
    await workspace.reset()
    await workspace.main.write_text(
        "tests/test_inventory.py",
        "from pathlib import Path\n"
        "def test_inventory():\n"
        "    Path('.env').write_bytes(b'VALUE=\\xff')\n"
        "    print('unverified child output')\n",
        expected_hash=None,
    )
    run = await workspace.run_tests(workspace.main, timeout_s=5)
    assert run.result.outcome == "error" and run.output == "[redacted]"
    assert "secret inventory unavailable" in run.problems
    assert not list(workspace.tmp_dir.glob("*.xml"))
    assert not list(workspace.tmp_dir.glob("*.jsonl"))
