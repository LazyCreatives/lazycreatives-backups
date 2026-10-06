"""A project saved after its last backup shows as changed until it's backed up again."""
import os

from ablebackup.catalog import Catalog
from ablebackup.scanner import scan_projects
from ablebackup.service import run_backup
from tests.helpers import write_als


def _lib(cat):
    return {r["name"]: r for r in cat.library()}


def test_changed_after_save_and_cleared_by_backup(tmp_path):
    src, dest = tmp_path / "src", tmp_path / "dest"
    als = write_als(src / "Anthem Project" / "Anthem.als", [])
    os.utime(als, (1_700_000_000, 1_700_000_000))
    cat = Catalog(tmp_path / "c.db")
    found = scan_projects([src])
    cat.upsert_discovered([{"project_id": p.project_id, "name": p.name, "path": str(p.project_path),
                            "dir": str(p.project_dir), "daw": p.daw_id, "owner": "x",
                            "size": p.size, "mtime": p.mtime, "missing_count": 0} for p in found], "t")
    assert _lib(cat)["Anthem"]["changed"] is False          # never backed up: not "changed"

    run_backup([src], dest, cat, timestamp="2026-10-05_1000")
    assert _lib(cat)["Anthem"]["backed_up"] is True
    assert _lib(cat)["Anthem"]["changed"] is False

    os.utime(als, (1_700_000_500, 1_700_000_500))           # saved again in the DAW
    assert _lib(cat)["Anthem"]["changed"] is True

    run_backup([src], dest, cat, timestamp="2026-10-05_1100")  # same content: skipped,
    assert _lib(cat)["Anthem"]["changed"] is False              # but now counted as current


def test_old_catalog_falls_back_to_backup_time(tmp_path):
    als = write_als(tmp_path / "P" / "P.als", [])
    os.utime(als, (1_000, 1_000))                            # saved long before the backup
    cat = Catalog(tmp_path / "c.db")
    cat.upsert_discovered([{"project_id": "p", "name": "P", "path": str(als), "dir": str(als.parent),
                            "daw": "ableton", "owner": "x", "size": 1, "mtime": 1_000,
                            "missing_count": 0}], "t")
    cat.record_snapshot("P", "2026-10-05_1000", 1, 1, "ok", [], project_id="p")
    assert _lib(cat)["P"]["changed"] is False


def test_library_reports_the_save_time_as_it_is_now(tmp_path):
    """A project saved in the music program since the last scan reads as just worked on
    (the narrow window and Home's "Recently worked on" pick it up without a re-scan)."""
    als = write_als(tmp_path / "Q" / "Q.als", [])
    os.utime(als, (1_000, 1_000))
    cat = Catalog(tmp_path / "c.db")
    cat.upsert_discovered([{"project_id": "q", "name": "Q", "path": str(als), "dir": str(als.parent),
                            "daw": "ableton", "owner": "x", "size": 1, "mtime": 1_000,
                            "missing_count": 0}], "t")
    os.utime(als, (5_000, 5_000))                            # saved again, no scan since
    assert _lib(cat)["Q"]["mtime"] == 5_000
    als.unlink()                                             # moved away: keeps the last known time
    assert _lib(cat)["Q"]["mtime"] == 1_000
