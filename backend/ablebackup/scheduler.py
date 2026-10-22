"""APScheduler-backed automatic backup runner."""
from pathlib import Path
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler

from datetime import datetime, timedelta

from ablebackup import entitlement, nas
from ablebackup.catalog import Catalog
from ablebackup.service import BackupDriveMissing, backup_in_progress, run_backup

_JOB_ID = "auto_backup"
_RETRY_ID = "auto_backup_retry"
RETRY_MINUTES = 15  # a NAS that didn't wake gets another go this much later


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
        try:
            run_backup(
                [Path(s) for s in sources], Path(dest), self._catalog,
                progress=progress, label="Auto", portable=True, find_missing=True,
                libraries=config.get("libraries", []), mirrors=mirrors,
            )
        except BackupDriveMissing:
            # The drive is unplugged: skip this run without making any folders. Home
            # already says "Backup drive not found"; the next timed run tries again.
            # A NAS that didn't wake up gets one more go a little later, and Home
            # says when (one quiet note, not an alarm).
            if nas.on_nas(self._catalog, dest) and self._scheduler.get_job(_RETRY_ID) is None:
                when = datetime.now() + timedelta(minutes=RETRY_MINUTES)
                self._scheduler.add_job(self._run_once, "date", run_date=when, id=_RETRY_ID)
                self._catalog.set_setting("nas_retry", when.isoformat(timespec="minutes"))
            return
        self._catalog.set_setting("nas_retry", None)

    def shutdown(self) -> None:
        self._scheduler.shutdown(wait=False)
