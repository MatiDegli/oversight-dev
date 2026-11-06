"""Known secret values take precedence over the heuristic's hexadecimal exemption."""

from pathlib import Path
from time import perf_counter

import pytest
from live_helpers import live_settings
from secret_fixtures import CANARY, COMMIT

from oversight.app import LiveRun
from oversight.redaction import Redactor


@pytest.mark.parametrize("value", [COMMIT, "abcdef0123456789" * 4])
def test_hex_object_ids_and_content_hashes_survive_unless_known_secret(
    tmp_path: Path, value: str
) -> None:
    workspace = LiveRun(live_settings(tmp_path)).workspace
    assert workspace.redact(f"tests/test_mod.py::test_value {value}") == (
        f"tests/test_mod.py::test_value {value}"
    )
    workspace.redactor.remember(value)
    assert workspace.redact(value) == "[redacted]"


@pytest.mark.parametrize("value", ["c3" * 12, "a9" * 16, "b4" * 20])
def test_shared_redactor_masks_credential_shaped_hex(value: str) -> None:
    assert Redactor(None)(value) == "[redacted]"


@pytest.mark.parametrize("assignment", ["VALUE=", "export VALUE = ", "VALUE='"])
def test_dotenv_values_and_fragments_are_masked(assignment: str) -> None:
    redact = Redactor(None)
    suffix = "' # explanation" if assignment.endswith("'") else " # explanation"
    redact.remember_file("sub/.env.local", assignment + "sk-" + CANARY + suffix + "\nSHORT=tiny\n")
    assert redact(CANARY) == "[redacted]"
    assert redact(CANARY[3:15]) == "[redacted]"
    assert redact("tiny explanation tests/test_mod.py") == "tiny explanation tests/test_mod.py"
    assert redact(redact(CANARY)) == "[redacted]"


@pytest.mark.parametrize("name", [".env", ".envs/.local/.django", "config.key"])
def test_secret_assignments_mask_whole_values_without_hiding_names_or_comments(name: str) -> None:
    redact = Redactor(None)
    value = "postgresql://localhost/test_db"
    redact.remember_file(name, f"# ordinary explanatory comment\nPRIVATE_DATABASE_URL={value}\n")
    assert redact(value) == "[redacted]"
    ordinary = "DATABASE_URL ordinary explanatory comment tests/test_db.py::test_connect"
    assert redact(ordinary) == ordinary


def test_runtime_path_is_removed_before_masking_its_components(tmp_path: Path) -> None:
    workspace = LiveRun(live_settings(tmp_path)).workspace
    workspace.redactor.remember(tmp_path.name)
    assert workspace.redact(f"{workspace.main.root}/tests/test_db.py") == "tests/test_db.py"


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


def test_ordinary_assignment_values_do_not_hide_diagnostics() -> None:
    redact = Redactor(None)
    redact.remember_file(
        ".env",
        "DB_HOST=localhost\nPOSTGRES_USER=postgres\nENVIRONMENT=production\n"
        "DATABASE_URL=postgresql://localhost/test_db\n",
    )
    text = (
        "localhost tests/test_postgres.py::test_production_settings postgresql://localhost/test_db"
    )
    assert redact(text) == text


@pytest.mark.parametrize(
    "name", ["DB_PASSWORD", "SECRET", "access_token", "API_KEY", "AUTH", "CREDENTIAL", "PRIVATE"]
)
def test_secret_named_assignments_keep_whole_value_protection(name: str) -> None:
    redact = Redactor(None)
    redact.remember_file(".env", f"{name}={CANARY}\n")
    assert redact(CANARY) == "[redacted]"
    assert redact(CANARY[:8]) == CANARY[:8]


@pytest.mark.parametrize("password", [CANARY, "sk-synthetic123456789"])
def test_url_passwords_are_masked_without_hiding_hosts_or_paths(password: str) -> None:
    redact = Redactor(None)
    url = f"postgresql://reader:{password}@localhost/test_db"
    redact.remember_file(".env", f"DATABASE_URL='{url}' # local database\n")
    assert redact(url) == "[redacted]"
    assert redact(password) == "[redacted]"
    ordinary = "localhost tests/test_db.py::test_connect local database"
    assert redact(ordinary) == ordinary


def test_malformed_url_does_not_interrupt_secret_collection() -> None:
    redact = Redactor(None)
    value = "https://[malformed"
    redact.remember_file(".env", f"NOTES={value}\nPRIVATE_VALUE={CANARY}\n")
    assert redact(value) == value
    assert redact(CANARY) == "[redacted]"


def test_whole_value_index_keeps_overlapping_and_shared_prefix_matches() -> None:
    redact = Redactor(None)
    for value in ("synthetic-first", "synthetic-second", "synthetic-second-longer", "tiny"):
        redact.remember(value, fragments=False)
    text = "synthetic-first synthetic-second-longer synthetic-third xtinyx"
    assert redact(text) == "[redacted] [redacted] synthetic-third x[redacted]x"
    assert redact(redact(text)) == redact(text)


@pytest.mark.timeout(10)
def test_large_assignment_inventory_redacts_output_quickly() -> None:
    redact = Redactor(None)
    values = [f"{i:08x}-synthetic-setting" for i in range(24_000)]
    content = "\n".join(f"SECRET_{i}={value}" for i, value in enumerate(values))
    assert len(content.encode()) < 1024 * 1024
    redact.remember_file(".env", content)
    ordinary = "tests/test_postgres.py::test_connect localhost\n" * 5_000
    text = ordinary + " ".join(values[::1_000])
    start = perf_counter()
    assert redact(text) == ordinary + " ".join(["[redacted]"] * 24)
    assert perf_counter() - start < 3
