"""Sequential fresh-process startup measurements; no provider calls or environment installs.

Run at nice 10 on an otherwise quiet host. JSON retains samples, importtime traces,
host contention, interpreter/dependency identity and medians. Readiness ends at the
first valid HTTP 200 /health, before shutdown; --demo-python avoids uv setup.
"""

import argparse
import asyncio
import contextlib
import hashlib
import importlib.metadata
import json
import os
import platform
import signal
import socket
import statistics
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT_S = 40


def environment(runtime: Path) -> dict[str, str]:
    """Explicit settings shared by both revisions; no inherited credentials or .env."""
    return {
        "PATH": os.environ.get("PATH", os.defpath),
        "HOME": str(runtime.parent),
        "LANG": "C.UTF-8",
        "OVERSIGHT_ENV_FILE": os.devnull,
        "OVERSIGHT_RUNTIME_DIR": str(runtime),
        "OVERSIGHT_HOST": "127.0.0.1",
        "OVERSIGHT_MAX_AGENTS": "1",
        "OVERSIGHT_AGENT_MODEL": "fake",
        "OVERSIGHT_FAKE_SCRIPT": str(ROOT / "fixtures/fake-model/document-apply-coupon.json"),
        "OVERSIGHT_REVIEW_MODEL": "fake-b",
        "OVERSIGHT_CROSS_REVIEW": "false",
        "OVERSIGHT_BEHAVIOR_DIFF": "false",
        "OVERSIGHT_MEASURED_CONE": "false",
        "OVERSIGHT_PREVIEW_ENABLED": "false",
    }


async def capture(argv: list[str], env: dict[str, str]) -> tuple[float, str, str]:
    started = time.perf_counter()
    child = await asyncio.create_subprocess_exec(
        *argv, cwd=ROOT, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        stdout, stderr = await asyncio.wait_for(child.communicate(), TIMEOUT_S)
        wall_s = time.perf_counter() - started
        if child.returncode != 0:
            raise RuntimeError(f"{argv!r}: exit {child.returncode}: {stderr.decode()}")
        return wall_s, stdout.decode(), stderr.decode()
    finally:
        if child.returncode is None:
            child.kill()
            await asyncio.wait_for(child.wait(), 5)


async def host() -> dict[str, object]:
    _, processes, _ = await capture(
        ["ps", "-eo", "pid,ppid,ni,pcpu,pmem,comm", "--sort=-pcpu"],
        {"PATH": os.environ.get("PATH", os.defpath), "LC_ALL": "C"},
    )
    return {
        "utc": datetime.now(UTC).isoformat(),
        "load_average": os.getloadavg(),
        "cpu_count": os.cpu_count(),
        "nice": os.getpriority(os.PRIO_PROCESS, 0),
        "competing_processes": processes.splitlines()[:21],
    }


def accounting(trace: str, target: str) -> dict[str, object]:
    rows: list[tuple[int, int, str]] = []
    for line in trace.splitlines():
        if not line.startswith("import time:"):
            continue
        parts = line.removeprefix("import time:").split("|", 2)
        if len(parts) == 3 and parts[0].strip().isdigit():
            rows.append((int(parts[0]), int(parts[1]), parts[2].strip()))
    total_self = sum(row[0] for row in rows)
    sdk_self = sum(row[0] for row in rows if row[2] == "openai" or row[2].startswith("openai."))
    return {
        "total_self_us": total_self,
        "target_cumulative_us": next(row[1] for row in rows if row[2] == target),
        "sdk_self_us": sdk_self,
        "sdk_cumulative_us": next((row[1] for row in rows if row[2] == "openai"), 0),
        "sdk_self_percent": 100 * sdk_self / total_self,
    }


async def health(port: int) -> bool:
    writer: asyncio.StreamWriter | None = None
    try:
        async with asyncio.timeout(0.25):
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(
                (
                    f"GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
                ).encode()
            )
            await writer.drain()
            response = await reader.read()
            headers, body = response.split(b"\r\n\r\n", 1)
            if headers.split(b"\r\n", 1)[0] != b"HTTP/1.1 200 OK":
                return False
            payload = json.loads(body)
            return payload.get("mode") == "live" and bool(payload.get("run_id"))
    except (OSError, TimeoutError, ValueError):
        return False
    finally:
        if writer is not None:
            writer.close()
            with contextlib.suppress(OSError):
                await asyncio.wait_for(writer.wait_closed(), 1)


async def cleanup(child: asyncio.subprocess.Process) -> None:
    """Reap the server and any remaining group members, even on failed readiness."""
    with contextlib.suppress(ProcessLookupError):
        os.killpg(child.pid, signal.SIGTERM)
    try:
        await asyncio.wait_for(child.wait(), 5)
    except TimeoutError:
        pass
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(child.pid, signal.SIGKILL)
        await asyncio.wait_for(child.wait(), 5)


async def readiness(env: dict[str, str], folder: Path) -> dict[str, object]:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    argv = [sys.executable, "-m", "oversight", "serve", "--demo-python", sys.executable]
    log = folder / "server.log"
    with log.open("wb") as output:
        started = time.perf_counter()
        child = await asyncio.create_subprocess_exec(
            *argv,
            cwd=ROOT,
            env=env | {"OVERSIGHT_PORT": str(port)},
            stdout=output,
            stderr=output,
            start_new_session=True,
        )
        try:
            async with asyncio.timeout(TIMEOUT_S):
                while not await health(port):
                    if child.returncode is not None:
                        raise RuntimeError(log.read_text())
                    await asyncio.sleep(0.01)
            wall_s = time.perf_counter() - started
        finally:
            await cleanup(child)
    return {"wall_s": wall_s, "argv": argv, "log": log.read_text(), "port": port}


async def measure(samples: int, output: Path) -> None:
    # Fail rather than accidentally measuring another checkout's editable install.
    env = environment(Path("/tmp/unused-lazy-benchmark/.runtime"))
    _, resolved, _ = await capture(
        [sys.executable, "-I", "-c", "import oversight; print(oversight.__file__)"], env
    )
    assert await asyncio.to_thread(Path(resolved.strip()).resolve) == (
        ROOT / "backend/src/oversight/__init__.py"
    )
    _, revision, _ = await capture(["git", "rev-parse", "HEAD"], env)
    report: dict[str, Any] = {
        "revision": revision.strip(),
        "helper_sha256": hashlib.sha256(
            await asyncio.to_thread(Path(__file__).read_bytes)
        ).hexdigest(),
        "lock_sha256": hashlib.sha256(
            await asyncio.to_thread((ROOT / "uv.lock").read_bytes)
        ).hexdigest(),
        "interpreter": sys.executable,
        "python": sys.version,
        "platform": platform.platform(),
        "dependencies": dict(
            sorted((d.metadata["Name"], d.version) for d in importlib.metadata.distributions())
        ),
        "settings": environment(Path("<fresh-directory>/.runtime")),
        "poll_interval_s": 0.01,
        "timeout_s": TIMEOUT_S,
        "samples": {},
        "medians": {},
    }
    for metric in ("app_import", "sdk_import", "health_readiness"):
        readings: list[dict[str, Any]] = []
        report["samples"][metric] = readings
        for index in range(samples):
            before = await host()
            with tempfile.TemporaryDirectory(prefix="lazy-openai-") as directory:
                folder = Path(directory)
                env = environment(folder / ".runtime")
                reading: dict[str, Any]
                if metric == "health_readiness":
                    reading = await readiness(env, folder)
                else:
                    target = "oversight.app" if metric == "app_import" else "openai"
                    argv = [sys.executable, "-X", "importtime", "-c", f"import {target}"]
                    wall, stdout, trace = await capture(argv, env)
                    reading = {
                        "wall_s": wall,
                        "argv": argv,
                        "stdout": stdout,
                        "importtime_trace": trace,
                        "importtime": accounting(trace, target),
                    }
                readings.append(reading | {"host_before": before, "host_after": await host()})
            await asyncio.to_thread(output.write_text, json.dumps(report, indent=2) + "\n")
            print(f"{metric} {index + 1}/{samples}: {reading['wall_s']:.6f} s", flush=True)
        report["medians"][metric] = statistics.median(float(r["wall_s"]) for r in readings)
    await asyncio.to_thread(output.write_text, json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["medians"], indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.samples < 1:
        parser.error("--samples must be positive")
    if sys.platform != "linux":
        parser.error("this controlled nice/load/process-group benchmark requires Linux")
    if os.getpriority(os.PRIO_PROCESS, 0) != 10:
        parser.error("run with nice -n 10")
    asyncio.run(measure(args.samples, args.output))


if __name__ == "__main__":
    main()
