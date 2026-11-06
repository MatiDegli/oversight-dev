"""Known secret values take precedence over the heuristic's hexadecimal exemption."""

from pathlib import Path

import pytest
from live_helpers import live_settings
from secret_fixtures import CANARY, COMMIT

from oversight.app import LiveRun
from oversight.redaction import Redactor


@pytest.mark.parametrize("value", [COMMIT, "abcdef0123456789" * 4])
def test_hex_object_ids_and_content_hashes_survive_unless_known_secret(value: str) -> None:
    assert Redactor(None)(f"tests/test_mod.py::test_value {value}") == (
        f"tests/test_mod.py::test_value {value}"
    )
    assert Redactor(value)(value) == "[redacted]"


@pytest.mark.parametrize("assignment", ["VALUE=", "export VALUE = ", "VALUE='"])
def test_dotenv_values_and_fragments_are_masked(assignment: str) -> None:
    redact = Redactor(None)
    suffix = "' # explanation" if assignment.endswith("'") else " # explanation"
    redact.remember_file("sub/.env.local", assignment + CANARY + suffix + "\nSHORT=tiny\n")
    assert redact(CANARY) == "[redacted]"
    assert redact(CANARY[3:15]) == "[redacted]"
    assert redact("tiny explanation tests/test_mod.py") == "tiny explanation tests/test_mod.py"
    assert redact(redact(CANARY)) == "[redacted]"


@pytest.mark.parametrize("name", ["private.pem", "private.key", "id_ed25519"])
def test_key_body_and_wrapped_pem_body_are_masked(name: str) -> None:
    redact = Redactor(None)
    body = CANARY + "\n" + "synthetic-private-material"
    redact.remember_file(
        name, "-----BEGIN PRIVATE KEY-----\n" + body + "\n-----END PRIVATE KEY-----"
    )
    assert redact(body) == "[redacted]\n[redacted]"
    assert redact(body.replace("\n", "")) == "[redacted]"
    assert redact("PRIVATE KEY tests/test_mod.py") == "PRIVATE KEY tests/test_mod.py"


def test_shapes_and_both_provider_keys_still_mask() -> None:
    redact = Redactor("provider-only-morning-credential", "provider-only-evening-credential")
    for value in (
        "morning-credential",
        "evening-credential",
        "Bearer abcdef123456",
        "sk-test12345678",
    ):
        assert redact(value) == "[redacted]"
    assert redact("a1b2c3d4e5f6g7h8i9j0k1l2m3n4") == "[redacted]"


def test_live_run_wires_both_provider_keys_into_workspace(tmp_path: Path) -> None:
    live = LiveRun(
        live_settings(
            tmp_path,
            meta_api_key="provider-only-morning-credential",
            baseten_api_key="provider-only-evening-credential",
        )
    )
    assert live.workspace.redact("morning-credential evening-credential") == (
        "[redacted] [redacted]"
    )
