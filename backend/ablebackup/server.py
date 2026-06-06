"""Uvicorn entrypoint for the backup sidecar (configured via environment)."""
import os
from pathlib import Path

from ablebackup.api.app import create_app

_DEFAULT_PORT = 8753


def _default_db_path() -> str:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".ablebackup")
    return str(Path(base) / "ablebackup" / "catalog.db")


def read_config() -> dict:
    return {
        "token": os.environ.get("ABLEBACKUP_TOKEN", ""),
        "port": int(os.environ.get("ABLEBACKUP_PORT", _DEFAULT_PORT)),
        "db_path": os.environ.get("ABLEBACKUP_DB", _default_db_path()),
    }


def build_app_from_env():
    cfg = read_config()
    return create_app(token=cfg["token"], db_path=Path(cfg["db_path"]))


def main() -> None:  # pragma: no cover - exercised manually / by Electron
    import uvicorn
    cfg = read_config()
    app = create_app(token=cfg["token"], db_path=Path(cfg["db_path"]))
    uvicorn.run(app, host="127.0.0.1", port=cfg["port"])


if __name__ == "__main__":  # pragma: no cover
    main()
