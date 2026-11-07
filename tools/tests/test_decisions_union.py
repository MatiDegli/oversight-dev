"""Exercise the repository's union attribute using only temporary Git repositories."""

import asyncio
import os
from pathlib import Path

import pytest

BASE = "# Decisions\n\n## Existing decision\n\nUse the agreed default.\n"
CHANGELOG_BASE = "# Changelog\n\n## Unreleased\n\n## 1.0.0\n\n- Keep the released entry.\n"
ATTRIBUTES = Path(__file__).resolve().parents[2] / ".gitattributes"


def git(repo: Path, *args: str) -> str:
    # Ignore host configuration and hook-exported paths; every Git command stays in tmp_path.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env |= {"GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

    async def run() -> str:
        process = await asyncio.create_subprocess_exec(
            "git",
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            *args,
            cwd=repo,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
        except TimeoutError:
            process.kill()
            await asyncio.wait_for(process.communicate(), timeout=10)
            raise
        assert process.returncode == 0, stdout.decode() + stderr.decode()
        return stdout.decode()

    return asyncio.run(run())


def commit_document(repo: Path, content: str, subject: str, filename: str = "DECISIONS.md") -> None:
    (repo / filename).write_text(content, encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", subject)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q", "-b", "main", "--template=")
    (tmp_path / ".gitattributes").write_text(ATTRIBUTES.read_text(), encoding="utf-8")
    (tmp_path / "CHANGELOG.md").write_text(CHANGELOG_BASE, encoding="utf-8")
    commit_document(tmp_path, BASE, "chore: add base documents")
    return tmp_path


def merge_branches(
    repo: Path, method: str, left: str, right: str, filename: str = "DECISIONS.md"
) -> str:
    git(repo, "checkout", "-q", "-b", "front-a", "main")
    commit_document(repo, left, "docs: record front a entry", filename)
    git(repo, "checkout", "-q", "-b", "front-b", "main")
    commit_document(repo, right, "docs: record front b entry", filename)
    git(repo, "checkout", "-q", "front-a")
    if method == "merge-tree":
        tree = git(repo, "merge-tree", "--write-tree", "front-a", "front-b").strip()
        return git(repo, "show", f"{tree}:{filename}")
    git(repo, "merge", "--no-ff", "-m", "chore: merge front b", "front-b")
    assert git(repo, "ls-files", "--unmerged") == ""
    return (repo / filename).read_text(encoding="utf-8")


@pytest.mark.parametrize("method", ["merge", "merge-tree"])
def test_parallel_appends_merge_without_conflict(repo: Path, method: str) -> None:
    entry_a = "\n## Front A\n\nKeep the first appended decision.\n"
    entry_b = "\n## Front B\n\nKeep the second appended decision.\n"
    merged = merge_branches(repo, method, BASE + entry_a, BASE + entry_b)
    assert merged.startswith(BASE)
    assert merged.count(entry_a) == 1
    assert merged.count(entry_b) == 1
    assert "<<<<<<<" not in merged


@pytest.mark.parametrize("method", ["merge", "merge-tree"])
def test_same_line_edits_keep_both_versions_for_review(repo: Path, method: str) -> None:
    """Union reports success even here: reviewers must catch edits to existing decisions."""
    old = "Use the agreed default.\n"
    left = "Use front A's default.\n"
    right = "Use front B's default.\n"
    merged = merge_branches(repo, method, BASE.replace(old, left), BASE.replace(old, right))
    assert old not in merged
    assert merged.count(left) == 1
    assert merged.count(right) == 1
    assert "<<<<<<<" not in merged


@pytest.mark.parametrize("method", ["merge", "merge-tree"])
def test_parallel_unreleased_bullets_merge_without_conflict(repo: Path, method: str) -> None:
    entry_a = "- Record front A's change.\n"
    entry_b = "- Record front B's change.\n"
    heading = "## Unreleased\n"
    merged = merge_branches(
        repo,
        method,
        CHANGELOG_BASE.replace(heading, heading + "\n" + entry_a),
        CHANGELOG_BASE.replace(heading, heading + "\n" + entry_b),
        "CHANGELOG.md",
    )
    unreleased, separator, released = merged.partition("## 1.0.0\n")
    assert unreleased.startswith("# Changelog\n\n" + heading)
    assert unreleased.count(entry_a) == 1
    assert unreleased.count(entry_b) == 1
    assert separator + released == CHANGELOG_BASE[CHANGELOG_BASE.index("## 1.0.0\n") :]
    assert "<<<<<<<" not in merged
