"""Print only resolved listener ports and preview pool; never source .env as shell."""

import os
from pathlib import Path

from oversight.settings import REPO_ROOT, read_env_file, resolve_ports, resolve_preview_profile


def main() -> None:
    env_file = Path(os.environ.get("OVERSIGHT_ENV_FILE", REPO_ROOT / ".env"))
    values = read_env_file(env_file) | dict(os.environ)
    port, vite_port = resolve_ports(values, development=True)
    pool = resolve_preview_profile(values, port, vite_port).ports
    if len(set(pool)) != len(pool) or any(
        not 1 <= preview_port <= 65535 or preview_port in (port, vite_port) for preview_port in pool
    ):
        raise ValueError("invalid OVERSIGHT_PREVIEW_PORTS pool")
    print(port, vite_port, ",".join(str(preview_port) for preview_port in pool))


if __name__ == "__main__":
    main()
