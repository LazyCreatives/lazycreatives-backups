import zipfile
from pathlib import Path

from ablebackup.backup_engine import backup_project
from ablebackup.scanner import scan_one
from ablebackup.service import restore_snapshot, share_snapshot
from tests.helpers import write_als, fileref_rel


def test_share_zips_a_complete_project(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    res = backup_project(scan_one(proj / "Song.als"), tmp_path / "NAS" / "AbletonBackups",
                         "2026-06-06_1200")
    out = tmp_path / "out"
    out.mkdir()

    zp = Path(share_snapshot(res.snapshot_dir, out))
    assert zp.suffix == ".zip" and zp.exists()
    with zipfile.ZipFile(zp) as z:
        names = z.namelist()
    assert any(n.endswith("Song.als") for n in names)
    assert any(n.endswith("Samples/loop.wav") for n in names)
    assert not any("manifest.json" in n for n in names)  # internal files excluded


def test_restore_copies_a_standalone_project(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    res = backup_project(scan_one(proj / "Song.als"), tmp_path / "NAS" / "AbletonBackups",
                         "2026-06-06_1200")

    target = tmp_path / "restored"
    target.mkdir()
    out = Path(restore_snapshot(res.snapshot_dir, target))

    assert out.parent == target
    assert "Song" in out.name and "2026-06-06_1200" in out.name  # named by project + date
    assert (out / "Song.als").exists()
    assert (out / "Samples" / "loop.wav").read_bytes() == b"loopdata"
    assert not (out / "manifest.json").exists()  # internal files left out
    assert not (out / ".abid").exists()


def test_restore_does_not_clobber_existing(tmp_path):
    proj = tmp_path / "Song Project"
    proj.mkdir()
    write_als(proj / "Song.als", [])
    res = backup_project(scan_one(proj / "Song.als"), tmp_path / "NAS" / "AbletonBackups", "t")
    target = tmp_path / "restored"
    target.mkdir()

    first = Path(restore_snapshot(res.snapshot_dir, target))
    second = Path(restore_snapshot(res.snapshot_dir, target))
    assert first != second and first.exists() and second.exists()  # suffixed, not overwritten
