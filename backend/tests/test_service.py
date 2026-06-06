from pathlib import Path
from ablebackup.catalog import Catalog
from ablebackup.service import scan_summary, run_backup
from tests.helpers import write_als, fileref_rel


def _build_project(root: Path):
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def test_scan_summary_is_serializable(tmp_path):
    _build_project(tmp_path)
    projects = scan_summary([tmp_path])
    assert len(projects) == 1
    p = projects[0]
    assert p["name"] == "Song"
    assert p["present_count"] == 1
    assert p["missing_count"] == 0
    assert isinstance(p["project_dir"], str)
    assert isinstance(p["total_size"], int)


def test_run_backup_records_and_emits_progress(tmp_path):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")
    events = []

    summary = run_backup([tmp_path], dest, cat, timestamp="2026-06-06_1430",
                         progress=events.append)

    assert summary["ok_count"] == 1
    assert summary["error_count"] == 0
    assert (dest / "AbletonBackups" / "projects" / "Song" / "2026-06-06_1430" / "Song.als").exists()
    assert cat.snapshots_for("Song")[0]["file_count"] == 2
    types = [e["type"] for e in events]
    assert "project_start" in types
    assert "project_done" in types
    assert events[-1] == {"type": "backup_done", "ok_count": 1, "error_count": 0}
    cat.close()


def test_run_backup_isolates_project_errors(tmp_path, monkeypatch):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")

    import ablebackup.service as svc
    def boom(scan, dest_root, timestamp):
        raise OSError("disk full")
    monkeypatch.setattr(svc, "backup_project", boom)

    summary = run_backup([tmp_path], dest, cat, timestamp="t", progress=None)

    assert summary["ok_count"] == 0
    assert summary["error_count"] == 1
    row = cat.snapshots_for("Song")[0]
    assert row["status"] == "error"
    assert "disk full" in row["error"]
    cat.close()
