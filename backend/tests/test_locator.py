from ablebackup.locator import build_index, make_locator


def test_index_and_locate_by_filename(tmp_path):
    lib = tmp_path / "Splice" / "sounds" / "packs" / "Cool Pack"
    lib.mkdir(parents=True)
    (lib / "T_kick_triangle.wav").write_bytes(b"audio")
    (lib / "notes.txt").write_bytes(b"not audio")

    locate = make_locator([tmp_path / "Splice"])

    # found by basename, regardless of the (different) path it was referenced by
    assert locate("/Users/someone-else/Splice/x/T_kick_triangle.wav") == lib / "T_kick_triangle.wav"
    assert locate("T_KICK_TRIANGLE.WAV") == lib / "T_kick_triangle.wav"  # case-insensitive
    assert locate("missing.wav") is None
    assert locate("notes.txt") is None  # non-audio not indexed


def test_index_first_match_wins_and_skips_backup_dirs(tmp_path):
    a = tmp_path / "A"; a.mkdir()
    (a / "loop.wav").write_bytes(b"a")
    backup = tmp_path / "A" / "Backup"; backup.mkdir()
    (backup / "loop.wav").write_bytes(b"old")

    index = build_index([tmp_path])
    assert "loop.wav" in index
    assert "Backup" not in str(index["loop.wav"])  # backup dirs are skipped
