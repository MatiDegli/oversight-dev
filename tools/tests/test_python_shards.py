"""Prove the live collection partition and the CI-only invocation without running the suite."""

import asyncio
import os
import signal
import sys
from collections import Counter
from pathlib import Path

import pytest
from tools.python_shards import parse_shard, shard_for_file
from tools.tests.test_verify_workflow import TRACKED, WORKFLOWS, mapping, steps

ROOT = Path(__file__).resolve().parents[2]
TESTPATHS = "contracts/tests backend/tests tools/tests tools/eval/tests"
BOUNDARIES = "tools/tests/test_eslint_boundaries.py"


def run(*args: str, environment: dict[str, str] | None = None) -> tuple[int, str]:
    async def execute() -> tuple[int, str]:
        env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("PYTEST_", "MAKE", "MFLAGS"))
            and key not in {"WORKERS", "RUN_TIMEOUT"}
        }
        env.update(environment or {})
        process = await asyncio.create_subprocess_exec(
            *args,
            cwd=ROOT,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=os.name != "nt",
        )
        try:
            output, _ = await asyncio.wait_for(process.communicate(), timeout=180)
        except BaseException:
            if process.returncode is None:
                if os.name == "nt":
                    process.kill()
                else:
                    os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
            raise
        assert process.returncode is not None
        return process.returncode, output.decode()

    return asyncio.run(execute())


def collect(*args: str, root: Path = ROOT) -> list[str]:
    code, output = run(
        str(Path(sys.executable).with_name("pytest")),
        "-c",
        str(ROOT / "pyproject.toml"),
        f"--rootdir={root}",
        "-o",
        "pythonpath=.",
        "--collect-only",
        # One -q prints full nodeids; the repository's additional -q would print file counts.
        "-o",
        "addopts=--strict-markers --import-mode=importlib",
        "-q",
        "-o",
        f"testpaths={TESTPATHS}",
        "-o",
        "faulthandler_timeout=400",
        f"--ignore={BOUNDARIES}",
        *args,
    )
    ids = [line for line in output.splitlines() if ".py::" in line]
    assert code == (0 if ids else 5), output
    if not ids:
        assert any(arg.startswith("--python-shard=") for arg in args), output
        assert "deselected" in output
    return ids


@pytest.mark.timeout(300)
def test_real_collection_is_a_disjoint_complete_balanced_partition() -> None:
    whole = collect()
    shards = [collect("-p", "tools.python_shards", f"--python-shard={i}/2") for i in (1, 2)]
    assert Counter(shards[0]) + Counter(shards[1]) == Counter(whole)
    assert set(shards[0]).isdisjoint(shards[1])
    assert all(BOUNDARIES not in nodeid for nodeid in whole)
    assert any(nodeid.startswith("tools/eval/tests/") for nodeid in whole)
    # A file hash is acceptable only while the observed collection remains balanced.
    assert max(map(len, shards)) / min(map(len, shards)) < 1.15
    owners: dict[str, int] = {}
    for index, ids in enumerate(shards):
        for nodeid in ids:
            path = nodeid.split("::", 1)[0]
            assert owners.setdefault(path, index) == index


def test_unknown_new_file_is_selected_once_and_xdist_runs_all_its_cases(tmp_path: Path) -> None:
    new = tmp_path / "test_unknown_future_file.py"
    new.write_text(
        "import pytest\n@pytest.mark.parametrize('value', range(3))\n"
        "def test_new(value):\n    assert value >= 0\n"
    )
    whole = collect(str(new), root=tmp_path)
    shards = [
        collect(str(new), "-p", "tools.python_shards", f"--python-shard={i}/2", root=tmp_path)
        for i in (1, 2)
    ]
    assert len(whole) == 3
    assert Counter(shards[0]) + Counter(shards[1]) == Counter(whole)
    assert set(shards[0]).isdisjoint(shards[1])
    assert sorted(map(len, shards)) == [0, 3]
    index = next(i for i, ids in enumerate(shards, start=1) if ids)
    code, output = run(
        str(Path(sys.executable).with_name("pytest")),
        "-c",
        str(ROOT / "pyproject.toml"),
        f"--rootdir={tmp_path}",
        "-o",
        "pythonpath=.",
        str(new),
        "-n",
        "2",
        "--max-worker-restart=0",
        "-p",
        "tools.python_shards",
        f"--python-shard={index}/2",
    )
    assert code == 0, output
    assert "3 passed" in output


@pytest.mark.parametrize("value", ["", "0/2", "3/2", "1/0", "1", "1/2/3", "-1/2", "01/2"])
def test_invalid_shards_fail_closed(value: str) -> None:
    with pytest.raises(pytest.UsageError, match="INDEX/TOTAL"):
        parse_shard(value)


def test_file_hash_is_stable_and_supports_other_counts() -> None:
    assert parse_shard("1/2") == (1, 2)
    assert parse_shard("3/3") == (3, 3)
    assert shard_for_file("backend/tests/test_lead_settings.py", 2) == 1
    for total in (1, 2, 3):
        assert 1 <= shard_for_file("tools/tests/test_future.py", total) <= total
    with pytest.raises(ValueError, match="positive"):
        shard_for_file("tools/tests/test_future.py", 0)


def test_ci_shard_keeps_local_caps_options_and_workers() -> None:
    code, local = run("make", "-n", "check-python")
    assert code == 0, local
    code, shard = run("make", "-n", "check-python-shard", "PYTHON_SHARD=1/2")
    assert code == 0, shard
    local_command = next(line for line in local.splitlines() if " pytest " in line)
    shard_command = next(line for line in shard.splitlines() if " pytest " in line)
    assert (
        shard_command
        == local_command + " -o pythonpath=. -p tools.python_shards --python-shard=1/2"
    )
    assert "ruff" not in shard
    for target in ("check-python", "check-python-shard"):
        code, output = run(
            "make",
            "-n",
            target,
            "PYTHON_SHARD=1/2",
            f"--eval={target}: dump-options",
            "--eval=dump-options: ; @echo options=$(PYTEST_ADDOPTS)",
            environment={"PYTEST_ADDOPTS": "--strict-config"},
        )
        assert code == 0, output
        assert (
            f"echo options=--strict-config -o 'testpaths={TESTPATHS}' -o faulthandler_timeout=400"
        ) in output


@pytest.mark.parametrize("filename", ["ci.yml", "verify.yml"])
def test_workflow_shards_keep_setup_evidence_and_independent_failure_results(filename: str) -> None:
    jobs = mapping(mapping((WORKFLOWS / filename).read_text())["jobs"])
    job = mapping(jobs["python-tests"])
    assert set(job) == {
        "name",
        "runs-on",
        "timeout-minutes",
        "env",
        "permissions",
        "strategy",
        "steps",
    }
    assert job["name"] == "python tests (${{ matrix.shard }}/2)"
    assert job["runs-on"] == "ubuntu-24.04"
    assert job["timeout-minutes"] == "20"
    assert mapping(job["env"]) == {"UV_PYTHON_PREFERENCE": "only-managed"}
    assert mapping(job["permissions"]) == {"contents": "read"}
    assert mapping(job["strategy"]) == {"fail-fast": "false", "matrix": "shard: [1, 2]"}
    check_steps = steps(mapping(jobs["check"])["steps"])
    check_index = check_steps.index({"run": "make check-ci"})
    shard_steps = steps(job["steps"])
    if filename == "verify.yml":
        assert shard_steps[-1] == TRACKED
        shard_steps = shard_steps[:-1]
    assert shard_steps[:-2] == check_steps[:check_index]
    assert shard_steps[-2] == {
        "name": "Python tests",
        "shell": "bash",
        "env": "PYTEST_ADDOPTS: --junitxml=.runtime/python-tests/results.xml",
        "run": "|\nmkdir -p .runtime/python-tests\n"
        "make check-python-shard PYTHON_SHARD=${{ matrix.shard }}/2 RUN_TIMEOUT=900 "
        "2>&1 | tee .runtime/python-tests/pytest.log",
    }
    assert shard_steps[-1] == {
        "name": "Upload Python test evidence",
        "if": "always()",
        "uses": "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2",
        "with": "name: python-test-evidence-${{ matrix.shard }}-of-2\n"
        "path: .runtime/python-tests/\ninclude-hidden-files: true\nretention-days: 7",
    }
