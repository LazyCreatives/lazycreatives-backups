"""An unplugged backup drive is noticed: nothing is made on the computer's own disk,
and the person is told to plug the drive in (never "not allowed")."""
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog
from ablebackup.scheduler import BackupScheduler
from ablebackup.service import (
    DRIVE_GONE, BackupDriveMissing, _holds_drives, prepare_dest, run_backup,
)
from tests.helpers import fileref_rel, write_als


def _project(root: Path) -> None:
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def _setup(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _project(src)
    return src, Catalog(tmp_path / "c.db")


def test_first_backup_makes_a_new_folder_inside_one_that_exists(tmp_path):
    src, cat = _setup(tmp_path)
    dest = tmp_path / "Lazy Creatives Backups"
    res = run_backup([src], dest, cat)
    assert res["ok_count"] == 1 and dest.is_dir()


def test_drive_unplugged_after_a_backup_is_not_made_again(tmp_path):
    src, cat = _setup(tmp_path)
    mount = tmp_path / "NAS"            # a mount point that stays when the share drops
    mount.mkdir()
    dest = mount / "Backups"
    run_backup([src], dest, cat)
    shutil.rmtree(dest)                  # the share is gone; the empty mount point stays
    with pytest.raises(BackupDriveMissing) as e:
        run_backup([src], dest, cat)
    assert str(e.value) == DRIVE_GONE
    assert not dest.exists()             # nothing quietly made on the computer's disk


def test_folder_seen_in_settings_then_missing_is_not_made_again(tmp_path):
    src, cat = _setup(tmp_path)
    dest = tmp_path / "Drive" / "Backups"
    dest.mkdir(parents=True)
    prepare_dest(cat, dest)              # seen once (Settings or Home did this)
    dest.rmdir()
    with pytest.raises(BackupDriveMissing):
        run_backup([src], dest, cat)
    assert not dest.exists()


def test_missing_parent_means_the_drive_is_unplugged(tmp_path):
    src, cat = _setup(tmp_path)
    dest = tmp_path / "unplugged" / "MyDrive" / "Backups"
    with pytest.raises(BackupDriveMissing):
        run_backup([src], dest, cat)
    assert not (tmp_path / "unplugged").exists()


def test_a_drive_name_under_volumes_is_never_made():
    assert _holds_drives(Path("/Volumes"))
    assert _holds_drives(Path("/media/robert"))
    assert _holds_drives(Path("/run/media/robert"))
    assert not _holds_drives(Path("/Users/robert/Dropbox"))


def test_api_says_plug_it_in_and_makes_nothing(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _project(src)
    dest = tmp_path / "unplugged" / "MyDrive" / "Backups"
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        r = c.post("/api/backup", json={"sources": [str(src)], "dest": str(dest)})
    assert r.status_code == 409
    assert r.json()["detail"] == DRIVE_GONE
    assert "allowed" not in r.json()["detail"]
    assert not (tmp_path / "unplugged").exists()


def test_api_remembers_the_drive_from_settings(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _project(src)
    (tmp_path / "Drive").mkdir()
    dest = tmp_path / "Drive" / "Backups"
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        c.put("/api/settings", json={"sources": [str(src)], "dest": str(dest), "interval_minutes": 0})
        assert dest.is_dir()             # picking a new folder in Settings makes it
        dest.rmdir()                     # ...then the drive goes away
        r = c.post("/api/backup", json={})
    assert r.status_code == 409 and r.json()["detail"] == DRIVE_GONE
    assert not dest.exists()


def test_timed_backup_skips_quietly_when_the_drive_is_gone(tmp_path):
    src, cat = _setup(tmp_path)
    dest = tmp_path / "unplugged" / "Backups"
    cat.set_setting("config", {"sources": [str(src)], "dest": str(dest), "interval_minutes": 30})
    sched = BackupScheduler(cat)
    try:
        sched._run_once()                # no exception, nothing made
    finally:
        sched.shutdown()
    assert not (tmp_path / "unplugged").exists()
    assert cat.snapshots_for("Song") == []

