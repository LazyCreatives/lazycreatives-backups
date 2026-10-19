"""Exported songs and stems go into each project's backup (and come back on restore)."""
import json
from pathlib import Path

from ablebackup.catalog import Catalog
from ablebackup.scanner import project_id
from ablebackup.service import restore_snapshot, run_backup
from tests.helpers import fileref_rel, write_als


def _setup(tmp_path: Path):
    proj = tmp_path / "src" / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    als = proj / "Song.als"
    write_als(als, [fileref_rel("Samples/loop.wav", "loop.wav")])
    out = tmp_path / "Exports"
    (out / "Stems").mkdir(parents=True)
    master = out / "Song master.wav"
    master.write_bytes(b"MASTER")
    older = out / "Song v1.wav"
    older.write_bytes(b"OLDER")
    kick = out / "Stems" / "Song - Kick.wav"
    kick.write_bytes(b"KICK")
    cat = Catalog(tmp_path / "c.db")
    pid = project_id(als)
    for f, kind in ((master, "song"), (older, "song"), (kick, "stem")):
        cat.link_export(str(f), pid, f.name, f.stat().st_size, f.stat().st_mtime, kind=kind)
    return cat, als, out


def _snap(dest: Path, ts: str) -> Path:
    return dest / "AbletonBackups" / "projects" / "Song" / ts


def test_songs_and_stems_are_backed_up_and_originals_untouched(tmp_path):
    cat, als, out = _setup(tmp_path)
    dest = tmp_path / "NAS"
    before = {p: p.read_bytes() for p in out.rglob("*.wav")}

    run_backup([als.parent.parent], dest, cat, timestamp="t1", als_paths=[str(als)])

    snap = _snap(dest, "t1")
    assert (snap / "Exported songs" / "Song master.wav").read_bytes() == b"MASTER"
    assert (snap / "Exported songs" / "Song v1.wav").read_bytes() == b"OLDER"  # every version
    assert (snap / "Exported songs" / "Stems" / "Song - Kick.wav").read_bytes() == b"KICK"
    files = json.loads((snap / "manifest.json").read_text())["files"]
    kinds = {f["logical_path"]: f.get("export") for f in files}
    assert kinds["Exported songs/Song master.wav"] == "song"
    assert kinds["Exported songs/Stems/Song - Kick.wav"] == "stem"
    assert kinds["Song.als"] is None
    assert {p: p.read_bytes() for p in out.rglob("*.wav")} == before
    cat.close()


def test_stems_left_out_when_switched_off(tmp_path):
    cat, als, _ = _setup(tmp_path)
    cat.set_setting("config", {"backup_stems": False})
    dest = tmp_path / "NAS"
    run_backup([als.parent.parent], dest, cat, timestamp="t1", als_paths=[str(als)])
    snap = _snap(dest, "t1")
    assert (snap / "Exported songs" / "Song master.wav").exists()
    assert not (snap / "Exported songs" / "Stems").exists()
    cat.close()


def test_new_export_makes_a_new_backup_and_gone_export_is_skipped(tmp_path):
    cat, als, out = _setup(tmp_path)
    dest = tmp_path / "NAS"
    roots = [als.parent.parent]
    assert run_backup(roots, dest, cat, timestamp="t1", als_paths=[str(als)])["ok_count"] == 1
    assert run_backup(roots, dest, cat, timestamp="t2", als_paths=[str(als)])["skipped_count"] == 1

    new = out / "Song v3.wav"
    new.write_bytes(b"NEWER")
    cat.link_export(str(new), project_id(als), new.name, 5, new.stat().st_mtime)
    (out / "Song v1.wav").unlink()  # deleted since: left out, backup still fine
    r = run_backup(roots, dest, cat, timestamp="t3", als_paths=[str(als)])
    assert r["ok_count"] == 1 and r["error_count"] == 0
    snap = _snap(dest, "t3")
    assert (snap / "Exported songs" / "Song v3.wav").read_bytes() == b"NEWER"
    assert not (snap / "Exported songs" / "Song v1.wav").exists()
    assert cat.snapshots_for("Song")[0]["status"] == "ok"
    cat.close()


def test_project_without_exports_keeps_its_old_signature(tmp_path):
    from ablebackup.scanner import scan_one
    from ablebackup.service import project_signature
    _, als, _ = _setup(tmp_path)
    scan = scan_one(als)
    assert project_signature(scan) == project_signature(scan, exports=[])


def test_restore_brings_the_songs_back(tmp_path):
    cat, als, _ = _setup(tmp_path)
    dest = tmp_path / "NAS"
    run_backup([als.parent.parent], dest, cat, timestamp="t1", als_paths=[str(als)])
    got = Path(restore_snapshot(_snap(dest, "t1"), tmp_path / "restored"))
    assert (got / "Song.als").exists()
    assert (got / "Exported songs" / "Song master.wav").read_bytes() == b"MASTER"
    assert (got / "Exported songs" / "Stems" / "Song - Kick.wav").read_bytes() == b"KICK"
    cat.close()
