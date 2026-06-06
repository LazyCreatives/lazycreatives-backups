import json
from pathlib import Path
from ablebackup.cli import run
from tests.helpers import write_als, fileref_rel


def _build_project(root: Path):
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def test_cli_scan_lists_projects(tmp_path, capsys):
    _build_project(tmp_path)
    code = run(["scan", "--source", str(tmp_path)])
    out = capsys.readouterr().out
    assert code == 0
    assert "Song" in out
    assert "1 file" in out or "1 ref" in out


def test_cli_backup_then_dedup(tmp_path):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    db = tmp_path / "catalog.db"

    code = run(["backup", "--source", str(tmp_path), "--dest", str(dest),
                "--db", str(db), "--timestamp", "2026-06-06_1430"])
    assert code == 0
    snap = dest / "AbletonBackups" / "projects" / "Song" / "2026-06-06_1430"
    assert (snap / "Song.als").exists()
    assert (snap / "Samples" / "loop.wav").exists()

    # Second run dedups: pool unchanged.
    pool = dest / "AbletonBackups" / "_pool"
    before = {p.name for p in pool.rglob("*") if p.is_file()}
    run(["backup", "--source", str(tmp_path), "--dest", str(dest),
         "--db", str(db), "--timestamp", "2026-06-06_1500"])
    after = {p.name for p in pool.rglob("*") if p.is_file()}
    assert before == after
