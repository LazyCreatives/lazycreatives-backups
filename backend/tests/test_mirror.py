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


def test_rclone_remote_detection():
    from ablebackup.service import _is_rclone_remote
    assert _is_rclone_remote("s3:bucket/path") is True
    assert _is_rclone_remote("gdrive:Backups") is True
    assert _is_rclone_remote("rclone:b2:bucket") is True
    assert _is_rclone_remote("/Users/me/Dropbox") is False
    assert _is_rclone_remote("/Volumes/NAS/backups") is False


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
    assert res["ok_count"] == 1       # primary backup still succeeded
    assert res["mirror_failed"] >= 1  # but the failed mirror is REPORTED, not swallowed


def test_rclone_found_outside_path(monkeypatch, tmp_path):
    """An app opened from the Dock/Start menu has no shell PATH, so a user-installed
    rclone in a usual folder (e.g. Homebrew's) still counts; the bundled one wins."""
    import os
    import sys
    from ablebackup import service

    monkeypatch.delenv("ABLEBACKUP_RCLONE", raising=False)
    monkeypatch.setattr(service.shutil, "which", lambda name: None)
    brew = tmp_path / "homebrew"
    brew.mkdir()
    exe = brew / ("rclone.exe" if sys.platform == "win32" else "rclone")
    exe.write_text("")
    os.chmod(exe, 0o755)
    monkeypatch.setattr(service, "_RCLONE_DIRS", (str(tmp_path / "nothing"), str(brew)))
    assert service.rclone_path() == str(exe)

    bundled = tmp_path / "bundled-rclone"
    bundled.write_text("")
    monkeypatch.setenv("ABLEBACKUP_RCLONE", str(bundled))
    assert service.rclone_path() == str(bundled)

    monkeypatch.setattr(service, "_RCLONE_DIRS", ())
    monkeypatch.setenv("ABLEBACKUP_RCLONE", str(tmp_path / "missing"))
    assert service.rclone_path() is None
