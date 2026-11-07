"""A failed repository inventory cannot disable the server's lead/message redactor."""

import asyncio
from pathlib import Path

import pytest
from backend.tests.api.lead_helpers import ThreadModels, send, start_idle
from live_helpers import DEADLINE_S, live_server, two_fakes
from secret_fixtures import CANARY

from oversight.workspace import WorkspaceError

pytestmark = pytest.mark.anyio


async def test_lead_message_survives_failed_inventory(tmp_path: Path) -> None:
    models = ThreadModels()
    async with (
        asyncio.timeout(DEADLINE_S),
        live_server(two_fakes(tmp_path), models) as server,
    ):
        agent_id = await start_idle(server)
        workspace = server.live.workspace
        (workspace.main.root / ".env").write_bytes(b"VALUE=\xff")
        with pytest.raises(WorkspaceError, match="secret inventory unavailable"):
            await workspace.run_tests(workspace.main, timeout_s=5)
        assert workspace.redact("repository diagnostics") == "[redacted]"
        text = "Please explain the failing test."
        await send(server, text, agent_id)
        [message] = [event for event in server.events() if event.type == "agent.message"]
        assert message.payload.text == text
        assert any(
            m.get("content") == text for model in models.built for r in model.requests for m in r
        )
        replies = [event for event in server.events() if event.type == "lead.reply"]
        assert replies[-1].payload.text == "A factual answer."


async def test_repository_inventory_does_not_rewrite_lead_messages(tmp_path: Path) -> None:
    async with (
        asyncio.timeout(DEADLINE_S),
        live_server(two_fakes(tmp_path), ThreadModels()) as server,
    ):
        agent_id = await start_idle(server)
        workspace = server.live.workspace
        (workspace.main.root / ".env").write_text(f"SECRET_VALUE={CANARY}\n")
        await workspace.run_tests(workspace.main, timeout_s=60)
        assert workspace.redact(CANARY) == "[redacted]"
        await send(server, CANARY, agent_id)
        [message] = [event for event in server.events() if event.type == "agent.message"]
        assert message.payload.text == CANARY
