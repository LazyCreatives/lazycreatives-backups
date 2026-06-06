"""APScheduler-backed automatic backup runner."""
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler

from ablebackup.catalog import Catalog
from ablebackup.service import run_backup

_JOB_ID = "auto_backup"


class BackupScheduler:
    def __init__(self, catalog: Catalog):
        self._catalog = catalog
        self._scheduler = BackgroundScheduler()
        self._scheduler.start(paused=False)

    def set_interval(self, minutes: int) -> None:
        existing = self._scheduler.get_job(_JOB_ID)
        if existing is not None:
            existing.remove()
        if minutes and minutes > 0:
            self._scheduler.add_job(
                self._run_once, "interval", minutes=minutes, id=_JOB_ID,
            )

    def job_count(self) -> int:
        return len(self._scheduler.get_jobs())

    def _run_once(self) -> None:
        config = self._catalog.get_setting("config") or {}
        sources = config.get("sources", [])
        dest = config.get("dest", "")
        if not sources or not dest:
            return  # nothing configured yet
        run_backup([Path(s) for s in sources], Path(dest), self._catalog)

    def shutdown(self) -> None:
        self._scheduler.shutdown(wait=False)
