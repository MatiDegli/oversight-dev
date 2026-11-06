"""Fresh interpreters prove SDK-free scripted production runs and first-use retries."""

import os
import sys
from pathlib import Path

import pytest

from oversight.settings import REPO_ROOT
from oversight.workspace import run_process

CHECKOUT = """
import sys
from pathlib import Path
root, isolated = map(Path, sys.argv[1:3])
import oversight
assert Path(oversight.__file__).resolve() == root / 'backend/src/oversight/__init__.py'
assert not any(n == 'openai' or n.startswith('openai.') for n in sys.modules)
"""

SCRIPTED = """
import asyncio
import builtins
import importlib.abc

def no_sdk():
    assert not any(n == 'openai' or n.startswith('openai.') for n in sys.modules)

class NoOpenAI(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'openai' or fullname.startswith('openai.'):
            raise AssertionError('attempted OpenAI import: ' + fullname)

original_import = builtins.__import__
def guarded_import(name, *args, **kwargs):
    if name == 'openai' or name.startswith('openai.'):
        raise AssertionError('attempted OpenAI import: ' + name)
    return original_import(name, *args, **kwargs)

sys.meta_path.insert(0, NoOpenAI())
builtins.__import__ = guarded_import
import oversight.app as app
assert Path(app.__file__).resolve() == root / 'backend/src/oversight/app.py'
no_sdk()
print('app imported without SDK', flush=True)

from dataclasses import replace
from fastapi.testclient import TestClient
from oversight.agents import ScriptedModel
from oversight.settings import Settings

settings = replace(Settings.load(), demo_python=Path(sys.executable))
assert settings.runtime_dir == isolated / '.runtime'
assert settings.meta_api_key is settings.baseten_api_key is None
assert settings.agent_model == 'fake' and settings.review_model == 'fake-b'
assert settings.cross_review is False
assert settings.env_file == Path(__import__('os').devnull)
# The unmodified production factory must select ScriptedModel for the author.
application = app.create_app(settings)
live = application.state.live
assert isinstance(live._default_client(live._slot_profiles['A'], 'A'), ScriptedModel)
with TestClient(application, base_url='http://127.0.0.1:8710') as http:
    assert http.get('/health').status_code == 200
    response = http.post('/agents', json={'task': 'Document apply_coupon.', 'model': 'fake'})
    assert response.status_code == 201, response.text
    async def completed():
        async with asyncio.timeout(40):
            async for event in live.store.subscribe(0):
                import json
                value = json.loads(event.envelope)
                if value['type'] == 'agent.status':
                    state = value['payload']['state']
                    assert state not in ('halted', 'stopped'), value
                    if state == 'ready_for_review':
                        return
        raise AssertionError('scripted run did not complete')
    http.portal.call(completed)
    no_sdk()
no_sdk()
print('scripted production run completed without SDK', flush=True)
"""

REAL_CLIENT = """
import asyncio
import json
import httpx2 as httpx
from oversight.agents import MUSE_SPARK, ModelAPIError, OpenAIClient, RetryPolicy
from oversight.agents.client import CALL_SCOPE, CallScope
from oversight.telemetry import CURRENT, Observer
assert 'openai' not in sys.modules

case, traced = sys.argv[3], sys.argv[4] == 'True'
calls, waits, failures, receipts = [], [], [], []
def transport(request):
    calls.append(json.loads(request.content))
    if len(calls) == 1:
        if case == 'timeout':
            raise httpx.ReadTimeout('timeout', request=request)
        if case == 'connection':
            raise httpx.ConnectError('offline', request=request)
        return httpx.Response(int(case), json={'error': {'message': 'test'}},
                              headers={'retry-after': '3'} if case == '429' else {})
    return httpx.Response(200, json={
        'id': 'fresh', 'object': 'chat.completion', 'created': 0,
        'model': MUSE_SPARK.model, 'choices': [{
            'index': 0, 'finish_reason': 'stop',
            'message': {'role': 'assistant', 'content': 'done'}}]})

async def sleep(delay): waits.append(delay)
async def observe(failure): failures.append(failure)
async def record(reply): receipts.append(reply)
async def admit(): pass

async def main():
    # No SDK test import before construction: exceptions must bind on first real use.
    model = OpenAIClient(MUSE_SPARK, base_url='http://127.0.0.1:1/v1',
                         api_key='mock-only', max_output_tokens=42,
                         retry=RetryPolicy(max_attempts=2), sleep=sleep, jitter=lambda: .25,
                         http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport)))
    import openai
    assert 'openai' in sys.modules
    token = CALL_SCOPE.set(CallScope(None, record, attempt_failed=observe,
                                   admission=admit, all_attempts=traced))
    trace_token = CURRENT.set(Observer(isolated / 'trace.jsonl') if traced else None)
    try:
        if case == '400':
            try:
                await model.complete([{'role': 'user', 'content': 'hi'}], [])
            except ModelAPIError as error:
                assert str(error) == 'model API error: HTTP 400'
                assert isinstance(error.__cause__, openai.APIStatusError)
            else:
                raise AssertionError('400 was not refused')
            assert waits == [] and len(calls) == 1
        else:
            reply = await model.complete([{'role': 'user', 'content': 'hi'}], [])
            assert reply.text == 'done' and reply.usage.input_tokens is None
            assert waits == ([3.0] if case == '429' else [.25]) and len(calls) == 2
        assert all(c['reasoning_effort'] == 'low' for c in calls)
        assert all(c['max_completion_tokens'] == 42 for c in calls)
        [failure] = failures
        assert failure['cause'] == {'429': 'rate_limited', '503': 'server_error',
            '400': 'refused', 'timeout': 'timeout', 'connection': 'connection'}[case]
        assert failure['final'] == ('not_retryable' if case == '400' else None)
        assert failure['wait_s'] == (None if case == '400' else waits[0])
        expected_receipts = len(calls) if traced else int(case in ('timeout', 'connection'))
        assert len(receipts) == expected_receipts
    finally:
        CURRENT.reset(trace_token)
        CALL_SCOPE.reset(token)
        await model.aclose()
asyncio.run(main())
print('fresh real client retry and diagnostics verified', flush=True)
"""


async def child(tmp_path: Path, code: str, *args: str) -> str:
    result = await run_process(
        [sys.executable, "-I", "-c", CHECKOUT + code, str(REPO_ROOT), str(tmp_path), *args],
        cwd=tmp_path,
        timeout_s=60,
        env={
            "HOME": str(tmp_path),
            "OVERSIGHT_ENV_FILE": os.devnull,
            "OVERSIGHT_RUNTIME_DIR": str(tmp_path / ".runtime"),
            "OVERSIGHT_AGENT_MODEL": "fake",
            "OVERSIGHT_MAX_AGENTS": "1",
            "OVERSIGHT_FAKE_SCRIPT": str(
                REPO_ROOT / "fixtures/fake-model/document-apply-coupon.json"
            ),
            "OVERSIGHT_REVIEW_MODEL": "fake-b",
            "OVERSIGHT_CROSS_REVIEW": "false",
            "OVERSIGHT_MEMORY_HOLD_PERCENT": "100",
        },
    )
    assert not result.timed_out and not result.truncated, result
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


@pytest.mark.anyio
async def test_scripted_production_run_never_imports_sdk(tmp_path: Path) -> None:
    output = await child(tmp_path, SCRIPTED)
    assert "app imported without SDK" in output
    assert "scripted production run completed without SDK" in output


@pytest.mark.anyio
@pytest.mark.parametrize("case", ["timeout", "connection", "429", "503", "400"])
@pytest.mark.parametrize("traced", [False, True])
async def test_first_real_client_retries_with_sdk_exception_classes(
    tmp_path: Path, case: str, traced: bool
) -> None:
    assert "fresh real client retry and diagnostics verified" in await child(
        tmp_path, REAL_CLIENT, case, str(traced)
    )
