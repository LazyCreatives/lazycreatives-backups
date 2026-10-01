"""Uvicorn entrypoint for the backup sidecar (configured via environment)."""
import os
import threading
import time
from pathlib import Path

from ablebackup.api.app import create_app

_DEFAULT_PORT = 8753
# After a stop is requested, uvicorn waits at most this long for in-flight requests
# (e.g. a slow scan of thousands of sample refs) before forcing exit — so quitting
# the desktop app never blocks on a request that is still running.
_GRACEFUL_SHUTDOWN_SECS = 3


def _default_db_path() -> str:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".ablebackup")
    return str(Path(base) / "ablebackup" / "catalog.db")


def read_config() -> dict:
    parent = os.environ.get("ABLEBACKUP_PARENT_PID")
    return {
        "token": os.environ.get("ABLEBACKUP_TOKEN", ""),
        "port": int(os.environ.get("ABLEBACKUP_PORT", _DEFAULT_PORT)),
        "db_path": os.environ.get("ABLEBACKUP_DB", _default_db_path()),
        "parent_pid": int(parent) if parent else None,
    }


def _parent_alive(pid: int) -> bool:
    """Whether process `pid` still exists. Signal 0 only probes — it sends nothing."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists but owned by another user (won't happen for our parent)
    return True


def install_parent_watchdog(parent_pid, *, poll_interval=2.0, on_dead=None,
                            alive=_parent_alive) -> threading.Thread:
    """Exit this process when the parent (Electron) goes away.

    Electron normally signals us to stop on quit, but a crash or a hard kill (SIGKILL)
    runs no cleanup and would otherwise leave this sidecar orphaned and running. Polling
    the parent pid guarantees we die with it. `on_dead`/`alive` are injectable so the
    behaviour is unit-testable without actually exiting the test process.
    """
    if on_dead is None:
        on_dead = lambda: os._exit(0)

    def loop():
        while True:
            if not alive(parent_pid):
                on_dead()
                return
            time.sleep(poll_interval)

    t = threading.Thread(target=loop, name="parent-watchdog", daemon=True)
    t.start()
    return t


def build_app_from_env():
    cfg = read_config()
    return create_app(token=cfg["token"], db_path=Path(cfg["db_path"]))


def main() -> None:  # pragma: no cover - exercised manually / by Electron
    import uvicorn
    cfg = read_config()
    if cfg["parent_pid"]:
        install_parent_watchdog(cfg["parent_pid"])
    app = create_app(token=cfg["token"], db_path=Path(cfg["db_path"]))
    uvicorn.run(
        app, host="127.0.0.1", port=cfg["port"],
        timeout_graceful_shutdown=_GRACEFUL_SHUTDOWN_SECS,
    )


if __name__ == "__main__":  # pragma: no cover
    # Required for the ProcessPoolExecutor (parallel scan) to work inside a
    # PyInstaller-frozen binary; harmless when run normally.
    import multiprocessing
    multiprocessing.freeze_support()
    main()
