"""Read-only exclusion of the running application and its development worktrees."""

import os
from pathlib import Path

from oversight.workspace.source_posix_git import GitLayout, inspect_layout
from oversight.workspace.source_posix_io import Witness, anchors, refuse


def excluded_identities(
    source: Path, roots: tuple[Path, ...], deadline: float
) -> tuple[tuple[Witness, ...], tuple[GitLayout, ...]]:
    """No repository Git query is needed to identify shared development worktrees."""
    selected = anchors(source)
    layouts: list[GitLayout] = []
    if os.path.lexists(source / ".git"):
        layouts.append(inspect_layout(source, deadline))
    witnesses: list[Witness] = []
    for root in dict.fromkeys(roots):
        chain = anchors(root)
        if (
            source.is_relative_to(root)
            or root.is_relative_to(source)
            or selected[-1].identity[:2] in {w.identity[:2] for w in chain}
            or chain[-1].identity[:2] in {w.identity[:2] for w in selected}
        ):
            raise refuse(
                "the running or reviewed Oversight source cannot be selected; "
                "choose another repository",
                "running-oversight-source",
            )
        witnesses.extend(chain)
        if os.path.lexists(root / ".git"):
            layout = inspect_layout(root, deadline)
            if (
                layouts
                and layouts[0].directories[-1].identity[:2] == layout.directories[-1].identity[:2]
            ):
                raise refuse(
                    "selection shares the running or reviewed Oversight Git common directory; "
                    "choose an independent repository",
                    "running-oversight-source",
                )
            # If selection has no Git marker, retain only exclusions, without comparing them.
            witnesses.extend(layout.directories)
    return tuple(dict.fromkeys(witnesses)), tuple(layouts)
