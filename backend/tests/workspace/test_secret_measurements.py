"""Measured and behavior evidence with private values is withheld before publication."""

import sys
from pathlib import Path

import pytest
from secret_fixtures import CANARY

from oversight.workspace import BehaviorTarget
from oversight.workspace.measured_report import CallTarget

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("private", ["inputs", "result", "identity"])
async def test_measured_values_are_withheld_after_inventory_refresh(
    make_workspace, private
) -> None:
    workspace = make_workspace(demo_python=Path(sys.executable))
    await workspace.acquire_runtime()
    await workspace.reset()
    await workspace.check_isolation()
    tree = workspace.main
    source = await tree.read_text("shop/mod.py")
    result = {
        "inputs": "0 if isinstance(x, str) else x",
        "result": (
            "__import__('pathlib').Path('.env').read_text().split('=', 1)[1] if x == 1 else x"
        ),
        "identity": "x",
    }[private]
    await tree.write_text(
        "shop/mod.py", f"def value(x):\n    return {result}\n", expected_hash=source.hash
    )
    parameter_id = "secret" if private == "identity" else repr("plain")
    # Create the secret inside pytest, after the first inventory. The recording must use
    # the refreshed inventory, including parameter identities and nested values.
    await tree.write_text(
        "tests/test_mod.py",
        "from pathlib import Path\nimport pytest\nfrom shop.mod import value\n"
        f"secret = {CANARY!r}\nPath('.env').write_text('SECRET_VALUE=' + secret)\n"
        f"@pytest.mark.parametrize('x', [1], ids=[{parameter_id}])\n"
        "def test_private(x):\n"
        + {
            "inputs": "    value(secret)\n",
            "result": "    value(1)\n",
            "identity": "    value(1)\n",
        }[private]
        + "def test_safe():\n    assert value(2) == 2\n",
        expected_hash=(await tree.read_text("tests/test_mod.py")).hash,
    )
    run = await workspace.run_tests(
        tree,
        timeout_s=10,
        isolation="required",
        measured_targets=(CallTarget("shop.mod:value", "shop/mod.py", "value", 1, 2),),
    )
    report = run.measured
    assert report is not None
    assert CANARY not in str(report)
    assert not report.complete and "secret-bearing invocations withheld" in report.problems
    [safe] = [call for call in report.calls if call.test_id.endswith("::test_safe")]
    assert safe.inputs is not None and safe.result is not None and safe.problem is None


@pytest.mark.parametrize("created_by_worker", [False, True])
async def test_behavior_results_use_inventory_before_and_after_worker(workspace, created_by_worker):
    await workspace.check_isolation()
    workspace._demo_python = Path(sys.executable)
    root = workspace.main.root
    if not created_by_worker:
        (root / ".env").write_text(f"SECRET_VALUE={CANARY}\n")
    (root / "shop/mod.py").write_text(
        "from pathlib import Path\n"
        "def value():\n"
        + (
            f"    Path('.env').write_text('SECRET_VALUE={CANARY}\\n')\n"
            if created_by_worker
            else ""
        )
        + "    return {'nested': [Path('.env').read_text().split('=', 1)[1].strip()]}\n"
    )
    target = BehaviorTarget("value", "shop.mod", "value", ("((), {})",))
    observations = await workspace.run_behavior(workspace.main, (target,), timeout_s=10)
    assert CANARY not in str(observations)
    assert observations["value"].results == ()
    assert observations["value"].problem == "secret-bearing behavior withheld"
    assert not list(workspace.tmp_dir.glob("behavior-*"))
