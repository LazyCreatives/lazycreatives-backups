"""APScheduler-backed automatic backup runner."""
from pathlib import Path
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler

from ablebackup import entitlement
from ablebackup.catalog import Catalog
from ablebackup.service import backup_in_progress, run_backup

_JOB_ID = "auto_backup"


class BackupScheduler:
    def __init__(self, catalog: Catalog, hub=None):
        self._catalog = catalog
        self._hub = hub  # so scheduled runs stream progress + fire the completion toast
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

    def next_run(self) -> Optional[str]:
        job = self._scheduler.get_job(_JOB_ID)
        if job is not None and job.next_run_time is not None:
            return job.next_run_time.isoformat()
        return None

    def _run_once(self) -> None:
        config = self._catalog.get_setting("config") or {}
        sources = config.get("sources", [])
        dest = config.get("dest", "")
        if not sources or not dest:
            return  # nothing configured yet
        if backup_in_progress():
            return  # a manual/previous backup is running — skip this auto tick
        tier = entitlement.verify_stored(self._catalog.get_setting("entitlement") or {})
        mirrors = config.get("mirrors", []) if entitlement.allows(tier, "cloud_backup") else []

        def progress(ev):
            if self._hub is not None:
                try:
                    self._hub.publish_threadsafe(ev)
                except RuntimeError:
                    pass  # loop not bound (shouldn't happen once the app is running)

        # Same good defaults as a manual backup: relink missing samples and make
        # snapshots portable; labelled so they're recognisable in history.
        run_backup(
            [Path(s) for s in sources], Path(dest), self._catalog,
            progress=progress, label="Auto", portable=True, find_missing=True,
            libraries=config.get("libraries", []), mirrors=mirrors,
        )

    def shutdown(self) -> None:
        self._scheduler.shutdown(wait=False)
