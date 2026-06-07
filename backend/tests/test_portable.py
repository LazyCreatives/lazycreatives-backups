from ablebackup.backup_engine import backup_project
from ablebackup.scanner import scan_one
from ablebackup.verifier import verify_snapshot
from tests.helpers import write_als, fileref_abs, fileref_rel


def _project_with_external(tmp_path):
    lib = tmp_path / "library"
    lib.mkdir()
    (lib / "kick.wav").write_bytes(b"kickkick")
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [
        fileref_abs(str(lib / "kick.wav"), "kick.wav"),       # external
        fileref_rel("Samples/loop.wav", "loop.wav"),          # internal
    ])
    return proj / "Song.als"


def test_archive_is_not_standalone_portable_but_portable_is(tmp_path):
    als = _project_with_external(tmp_path)
    dest = tmp_path / "NAS" / "AbletonBackups"
    scan = scan_one(als)

    archive = backup_project(scan, dest, "t_archive", portable=False)
    va = verify_snapshot(archive.snapshot_dir)
    assert va["portable_ok"] is False           # external sample resolves only via its absolute path
    assert va["portable_missing"]               # names what wouldn't open elsewhere

    portable = backup_project(scan, dest, "t_portable", portable=True)
    vp = verify_snapshot(portable.snapshot_dir)
    assert vp["portable_ok"] is True            # every sample resolves from inside the snapshot
    assert vp["ok"] is True                     # and still passes integrity (re-hash)
    assert (portable.snapshot_dir / "_External" / "kick.wav").exists()


def test_portable_is_noop_for_fully_internal_project(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    dest = tmp_path / "NAS" / "AbletonBackups"

    res = backup_project(scan_one(proj / "Song.als"), dest, "t", portable=True)
    assert verify_snapshot(res.snapshot_dir)["portable_ok"] is True
