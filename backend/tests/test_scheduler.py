from pathlib import Path
from ablebackup.catalog import Catalog
from ablebackup.scheduler import BackupScheduler
from tests.helpers import write_als, fileref_rel


def _build_project(root: Path):
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def test_set_interval_registers_and_clears_job(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    sched = BackupScheduler(cat)
    assert sched.job_count() == 0
    sched.set_interval(30)
    assert sched.job_count() == 1
    sched.set_interval(45)  # replaces, not adds
    assert sched.job_count() == 1
    sched.set_interval(0)   # disables
    assert sched.job_count() == 0
    sched.shutdown()


def test_run_once_backs_up_saved_config(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _build_project(src)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")
    cat.set_setting("config", {"sources": [str(src)], "dest": str(dest),
                               "interval_minutes": 30})
    sched = BackupScheduler(cat)

    sched._run_once()

    assert len(cat.snapshots_for("Song")) == 1
    assert (dest / "AbletonBackups" / "projects" / "Song").exists()
    sched.shutdown()


def test_run_once_noop_without_config(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    sched = BackupScheduler(cat)
    sched._run_once()  # must not raise when sources/dest unset
    sched.shutdown()
