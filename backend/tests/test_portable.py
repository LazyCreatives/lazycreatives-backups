import gzip
import re

from ablebackup.backup_engine import backup_project
from ablebackup.scanner import scan_one
from ablebackup.verifier import verify_snapshot
from tests.helpers import write_als, fileref_abs, fileref_rel


def test_crafted_project_cannot_pull_a_non_media_file(tmp_path):
    # A received/malicious project referencing a secret outside its folder must NOT
    # pull that file into the backup (info-disclosure guard).
    secret = tmp_path / "secret.key"
    secret.write_text("PRIVATE KEY")
    proj = tmp_path / "Song Project"
    proj.mkdir()
    write_als(proj / "Song.als", [fileref_abs(str(secret), "secret.key")])

    scan = scan_one(proj / "Song.als")
    assert not any(r.exists and r.resolved_path == secret for r in scan.refs)  # refused
    assert any(not r.exists for r in scan.refs)                                # marked missing


def test_portable_keeps_same_basename_externals_distinct(tmp_path):
    # Two different samples both named kick.wav from different libraries: the
    # portable .als must point each ref at a DISTINCT stored file (regression for
    # the silent-wrong-sample collision).
    libA = tmp_path / "A"; libA.mkdir(); (libA / "kick.wav").write_bytes(b"AAAAAAAA")
    libB = tmp_path / "B"; libB.mkdir(); (libB / "kick.wav").write_bytes(b"BBBBBBBBBBBB")
    proj = tmp_path / "Song Project"; proj.mkdir()
    write_als(proj / "Song.als", [
        fileref_abs(str(libA / "kick.wav"), "kick.wav"),
        fileref_abs(str(libB / "kick.wav"), "kick.wav"),
    ])
    res = backup_project(scan_one(proj / "Song.als"), tmp_path / "NAS" / "AbletonBackups",
                         "t", portable=True)

    stored = list((res.snapshot_dir / "_External").glob("kick*.wav"))
    assert len(stored) == 2  # two distinct files kept (one disambiguated)
    xml = gzip.open(next(res.snapshot_dir.glob("*.als")), "rt", encoding="utf-8").read()
    rels = re.findall(r'RelativePath Value="(_External/[^"]+)"', xml)
    assert len(rels) == 2 and len(set(rels)) == 2          # two DISTINCT relative paths
    for r in rels:
        assert (res.snapshot_dir / r).exists()             # each resolves to a real file


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
