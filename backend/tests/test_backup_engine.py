from ablebackup.backup_engine import supports_hardlinks


def test_supports_hardlinks_true_on_tmp(tmp_path):
    # Local temp filesystems support hardlinks on all CI platforms we target.
    assert supports_hardlinks(tmp_path) is True


def test_detection_leaves_no_residue(tmp_path):
    supports_hardlinks(tmp_path)
    assert list(tmp_path.iterdir()) == []


import json
from pathlib import Path
from ablebackup.backup_engine import backup_project
from ablebackup.scanner import scan_projects
from tests.helpers import write_als, fileref_rel, fileref_abs


def _make_project(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    ext_lib = tmp_path / "lib"
    ext_lib.mkdir()
    (ext_lib / "kick.wav").write_bytes(b"kickdata")
    write_als(proj / "Song.als", [
        fileref_rel("Samples/loop.wav", "loop.wav"),
        fileref_abs(str(ext_lib / "kick.wav"), "kick.wav"),
    ])
    return scan_projects([proj])[0]


def test_backup_creates_self_contained_snapshot(tmp_path):
    scan = _make_project(tmp_path)
    dest = tmp_path / "NAS" / "AbletonBackups"

    result = backup_project(scan, dest, timestamp="2026-06-06_1430")

    snap = dest / "projects" / "Song" / "2026-06-06_1430"
    assert (snap / "Song.als").exists()
    assert (snap / "Samples" / "loop.wav").read_bytes() == b"loopdata"
    assert (snap / "_External" / "kick.wav").read_bytes() == b"kickdata"
    manifest = json.loads((snap / "manifest.json").read_text())
    assert manifest["project_name"] == "Song"
    assert manifest["file_count"] == 3  # als + loop + kick
    assert result.file_count == 3
    assert result.missing == []


def test_second_backup_dedups_unchanged_files(tmp_path):
    scan = _make_project(tmp_path)
    dest = tmp_path / "NAS" / "AbletonBackups"
    backup_project(scan, dest, timestamp="2026-06-06_1430")

    # Re-scan and back up again at a new timestamp; pool must not grow.
    scan2 = scan_projects([scan.project_dir.parent])
    scan2 = [s for s in scan2 if s.name == "Song"][0]
    pool_before = {p.name for p in (dest / "_pool").rglob("*") if p.is_file()}
    backup_project(scan2, dest, timestamp="2026-06-06_1500")
    pool_after = {p.name for p in (dest / "_pool").rglob("*") if p.is_file()}

    assert pool_before == pool_after  # no new pool entries for unchanged files
    assert (dest / "projects" / "Song" / "2026-06-06_1500" / "Song.als").exists()


def test_missing_ref_recorded_not_fatal(tmp_path):
    proj = tmp_path / "Song Project"
    proj.mkdir(parents=True)
    write_als(proj / "Song.als", [fileref_rel("Samples/gone.wav", "gone.wav")])
    scan = scan_projects([proj])[0]
    dest = tmp_path / "NAS" / "AbletonBackups"

    result = backup_project(scan, dest, timestamp="2026-06-06_1430")

    assert result.missing == ["Samples/gone.wav"]
    assert (dest / "projects" / "Song" / "2026-06-06_1430" / "Song.als").exists()
