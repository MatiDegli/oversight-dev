"""Refusal categories come from real checks; one line at the startup boundary."""

from unittest.mock import AsyncMock

import pytest
from live_helpers import live_settings
from workspace.test_source_nt_copy import git
from workspace.test_source_nt_reset import opened

from oversight.app import create_app
from oversight.startup_refusals import startup_refusals
from oversight.workspace import source_nt as nt
from oversight.workspace._platform import preflight_placement


def test_constructor_and_lifespan_refusals_print_once(tmp_path, monkeypatch, capsys):
    with pytest.raises(ValueError):
        create_app(live_settings(tmp_path, workspace_source="unknown"))
    assert capsys.readouterr().err == "OVERSIGHT_REFUSAL=other\n"


@pytest.mark.parametrize("kind", ["not-standalone-repo", "unsupported-location", "path-too-long"])
def test_real_checks_emit_each_category(tmp_path, capsys, kind):
    with pytest.raises(OSError), startup_refusals():
        if kind == "not-standalone-repo":
            nt.repository(tmp_path, ())
        elif kind == "unsupported-location":
            preflight_placement(r"\\server\repo", nt=True)
        else:
            nt.short_path("C:/" + "x" * 240)
    assert capsys.readouterr().err == f"OVERSIGHT_REFUSAL={kind}\n"


@pytest.mark.anyio
async def test_previous_main_change_keeps_its_category_through_guard(tmp_path, capsys):
    async with opened(tmp_path) as (workspace, own, _):
        await git(workspace.main.root, "commit", "--allow-empty", "-qm", "Approved change")
        with pytest.raises(OSError), startup_refusals():
            nt.guard_previous(own.runtime)
        assert capsys.readouterr().err == "OVERSIGHT_REFUSAL=previous-session-changed\n"


@pytest.mark.anyio
async def test_lifespan_refusal_is_once_and_releases_ledger(tmp_path, monkeypatch, capsys):
    from oversight.workspace import acquire_lock, release_lock

    app = create_app(live_settings(tmp_path))
    monkeypatch.setattr(app.state.live, "_reset_workspace", AsyncMock(side_effect=OSError("stop")))
    with pytest.raises(OSError):
        async with app.router.lifespan_context(app):
            pytest.fail("startup refusal ignored")
    assert capsys.readouterr().err == "OVERSIGHT_REFUSAL=other\n"
    fd = acquire_lock(app.state.live._settings.ledger_root / "ledger.lock")
    release_lock(fd)


def test_cli_bind_refusal_and_nested_lifespan_exit_are_once(tmp_path, monkeypatch, capsys):
    import sys

    from oversight import __main__ as cli
    from oversight.settings import Settings

    monkeypatch.setattr(sys, "argv", ["oversight", "serve"])
    monkeypatch.setattr(Settings, "load", lambda: live_settings(tmp_path))

    def bind_refused(*args, **kwargs):
        raise OSError("listener refused")

    monkeypatch.setattr("oversight.__main__.uvicorn.run", bind_refused)
    with pytest.raises(OSError):
        cli.main()
    assert capsys.readouterr().err == "OVERSIGHT_REFUSAL=other\n"

    def lifespan_refused(*args, **kwargs):
        try:
            with startup_refusals():
                nt.short_path("C:/" + "x" * 240)
        except OSError:
            raise SystemExit(3) from None

    monkeypatch.setattr("oversight.__main__.uvicorn.run", lifespan_refused)
    with pytest.raises(SystemExit):
        cli.main()
    assert capsys.readouterr().err == "OVERSIGHT_REFUSAL=path-too-long\n"


@pytest.mark.parametrize("command", ["serve", "ledger", "replay"])
def test_settings_failure_prints_category_only_for_server_startup(command, monkeypatch, capsys):
    import sys

    from oversight import __main__ as cli
    from oversight.settings import Settings

    args = ["oversight", command]
    if command == "replay":
        args.append("unused-recording.jsonl")
    monkeypatch.setattr(sys, "argv", args)

    def unavailable():
        raise ValueError("invalid settings")

    monkeypatch.setattr(Settings, "load", unavailable)
    with pytest.raises(ValueError, match=r"^invalid settings$"):
        cli.main()
    assert capsys.readouterr().err == ("OVERSIGHT_REFUSAL=other\n" if command == "serve" else "")


@pytest.mark.anyio
@pytest.mark.parametrize(
    "category",
    [
        "missing-git",
        "source-permissions",
        "unsafe-git-config",
        "source-changed",
        "source-budget-exceeded",
        "runtime-unavailable",
        "running-oversight-source",
    ],
)
async def test_posix_leaf_categories_emit_once_per_attempt(tmp_path, monkeypatch, capsys, category):
    from workspace.test_source_posix import GIT, git, repository

    from oversight.workspace import source_posix as posix
    from oversight.workspace import source_posix_policy as policy

    source = await repository(tmp_path)

    async def fail():
        if category == "missing-git":
            await posix.inventory(source, git=str(tmp_path / "no-git"))
        elif category == "source-permissions":
            source.root.chmod(0o777)
            await posix.prepare_source(source.root, source.runtime, source.ide)
        elif category == "unsafe-git-config":
            await git(source.root, "config", "include.path", "/must-not-read")
            await posix.inventory(source, git=GIT)
        elif category == "source-changed":
            listing = await posix.inventory(source, git=GIT)
            head = source.root / ".git/HEAD"
            data = head.read_bytes()
            head.write_text("changed")
            try:
                await posix.validate_selection(listing)
            finally:
                head.write_bytes(data)
        elif category == "source-budget-exceeded":
            await posix.inventory(source, git=GIT, deadline=-1)
        elif category == "runtime-unavailable":
            monkeypatch.setattr(policy, "mount_for", lambda path: policy.Mount(path, "9p", True))
            policy.require_linux_state(source.runtime)
        else:
            await posix.prepare_source(source.root, source.runtime, source.root)

    with pytest.raises(OSError), startup_refusals(), startup_refusals():
        await fail()
    assert capsys.readouterr().err == f"OVERSIGHT_REFUSAL={category}\n"
    with pytest.raises(OSError), startup_refusals():
        await fail()
    assert capsys.readouterr().err == f"OVERSIGHT_REFUSAL={category}\n"
