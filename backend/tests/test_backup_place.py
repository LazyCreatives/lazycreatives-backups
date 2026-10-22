"""Backups left in an old backup place don't count once you switch to a new one."""
import os

from ablebackup.catalog import Catalog


def _cat(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    cat.upsert_discovered([{"project_id": "p1", "name": "Night Drive", "path": str(tmp_path / "a.als"),
                            "dir": str(tmp_path), "daw": "ableton", "owner": "", "size": 1, "mtime": 0,
                            "missing_count": 0}], "2026-10-22")
    old = str(tmp_path / "OldDrive" / "AbletonBackups" / "projects" / "Night Drive" / "2026-10-20_1200")
    cat.record_snapshot("Night Drive", "2026-10-20_1200", 10, 1, "ok", [], dir=old, signature="sig",
                        project_id="p1")
    return cat


def test_a_backup_on_the_old_drive_stops_counting_after_a_switch(tmp_path):
    cat = _cat(tmp_path)
    cat.set_setting("config", {"sources": [], "dest": str(tmp_path / "OldDrive")})
    assert cat.library()[0]["backed_up"] is True
    assert cat.latest_signatures() == {"p1": "sig"}

    cat.set_setting("config", {"sources": [], "dest": str(tmp_path / "NAS" / "Lazy Creatives Backups")})
    assert cat.library()[0]["backed_up"] is False      # not safe on the NAS yet
    assert cat.latest_signatures() == {}               # so the next backup copies it there


def test_a_place_that_comes_back_at_a_new_path_keeps_its_backups(tmp_path):
    cat = _cat(tmp_path)
    cat.move_dirs(str(tmp_path / "OldDrive"), str(tmp_path / "OldDrive-1"))
    cat.set_setting("config", {"sources": [], "dest": str(tmp_path / "OldDrive-1")})
    assert cat.library()[0]["backed_up"] is True
    assert cat.latest_signatures() == {"p1": "sig"}


def test_a_similar_named_folder_is_not_the_same_place(tmp_path):
    cat = _cat(tmp_path)
    cat.set_setting("config", {"sources": [], "dest": str(tmp_path / "Old")})
    assert cat.library()[0]["backed_up"] is False
