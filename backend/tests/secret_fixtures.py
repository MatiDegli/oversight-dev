"""Synthetic dotenv leak used by boundary tests; no provider calls or real credentials."""

from oversight.workspace import Tree

CANARY = "mauve-heron-lantern-735902"
COMMIT = "0123456789abcdef0123456789abcdef0123abcd"
TEST_ID = "tests/test_secret.py::test_secret"
FAILURE = (
    "from pathlib import Path\n"
    "import pytest\n\n"
    "def test_secret():\n"
    f"    print('commit {COMMIT}')\n"
    "    value = Path('.env').read_text().split('=', 1)[1].strip()\n"
    "    pytest.fail(value)\n"
)


async def install_failure(tree: Tree) -> None:
    await tree.write_text(".env", f"PRIVATE_VALUE={CANARY}\n", expected_hash=None)
    await tree.write_text("tests/test_secret.py", FAILURE, expected_hash=None)
