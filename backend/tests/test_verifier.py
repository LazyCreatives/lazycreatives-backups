from pathlib import Path

from ablebackup.backup_engine import backup_project
from ablebackup.scanner import scan_one
from ablebackup.verifier import verify_snapshot
from tests.helpers import write_als, fileref_rel


def _backup(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    dest = tmp_path / "NAS" / "AbletonBackups"
    return backup_project(scan_one(proj / "Song.als"), dest, "2026-06-06_1200")


def test_verify_ok_on_fresh_backup(tmp_path):
    res = _backup(tmp_path)
    v = verify_snapshot(res.snapshot_dir, deep=True)
    assert v["ok"] is True
    assert v["checked"] == res.file_count == 2
    assert v["present"] == v["checked"]
    assert v["bad_files"] == [] and v["missing_files"] == []
    # internal-only project resolves entirely from the snapshot -> portable
    assert v["portable_ok"] is True


def test_verify_detects_missing_file(tmp_path):
    res = _backup(tmp_path)
    (res.snapshot_dir / "Samples" / "loop.wav").unlink()
    v = verify_snapshot(res.snapshot_dir, deep=False)
    assert v["ok"] is False
    assert "Samples/loop.wav" in v["missing_files"]


def test_verify_detects_corruption(tmp_path):
    res = _backup(tmp_path)
    bad = res.snapshot_dir / "Samples" / "loop.wav"
    bad.unlink()  # break the hardlink so we corrupt only this snapshot copy
    bad.write_bytes(b"loopdata-but-corrupted-different")
    v = verify_snapshot(res.snapshot_dir, deep=True)
    assert v["ok"] is False
    assert "Samples/loop.wav" in v["bad_files"]


def test_verify_reports_unverifiable_old_snapshot(tmp_path):
    res = _backup(tmp_path)
    import json
    mpath = res.snapshot_dir / "manifest.json"
    m = json.loads(mpath.read_text())
    del m["files"]  # simulate a snapshot written before file-level manifests
    mpath.write_text(json.dumps(m))
    v = verify_snapshot(res.snapshot_dir)
    assert v["ok"] is False
    assert "predates" in v["error"]
