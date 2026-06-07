from ablebackup.catalog import Catalog
from ablebackup.service import run_backup
from tests.helpers import write_als, fileref_rel


def test_run_backup_mirrors_snapshot_offsite(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    dest = tmp_path / "NAS"
    mirror = tmp_path / "Dropbox"
    cat = Catalog(tmp_path / "c.db")

    run_backup([proj], dest, cat, timestamp="2026-06-06_1200", mirrors=[str(mirror)])

    snap = mirror / "AbletonBackups" / "projects" / "Song" / "2026-06-06_1200"
    assert (snap / "Song.als").exists()                                  # offsite copy exists
    assert (snap / "Samples" / "loop.wav").read_bytes() == b"loopdata"   # samples too


def test_mirror_failure_does_not_break_primary(tmp_path):
    proj = tmp_path / "Song Project"
    proj.mkdir()
    write_als(proj / "Song.als", [])
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")

    # an impossible mirror target (a file, not a dir) must not fail the backup
    bad = tmp_path / "bad"
    bad.write_text("not a folder")
    res = run_backup([proj], dest, cat, timestamp="t", mirrors=[str(bad / "sub")])
    assert res["ok_count"] == 1  # primary backup still succeeded
