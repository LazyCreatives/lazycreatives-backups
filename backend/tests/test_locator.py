from ablebackup.locator import build_index, make_locator


def test_index_and_locate_by_filename(tmp_path):
    lib = tmp_path / "Splice" / "sounds" / "packs" / "Cool Pack"
    lib.mkdir(parents=True)
    (lib / "T_kick_triangle.wav").write_bytes(b"audio")
    (lib / "notes.txt").write_bytes(b"not audio")

    locate = make_locator([tmp_path / "Splice"])

    assert locate("/elsewhere/T_kick_triangle.wav") == [lib / "T_kick_triangle.wav"]
    assert locate("T_KICK_TRIANGLE.WAV") == [lib / "T_kick_triangle.wav"]  # case-insensitive
    assert locate("missing.wav") == []
    assert locate("notes.txt") == []  # non-audio not indexed


def test_index_returns_all_candidates_and_skips_backup_dirs(tmp_path):
    a = tmp_path / "A"; a.mkdir()
    (a / "loop.wav").write_bytes(b"a")
    b = tmp_path / "B"; b.mkdir()
    (b / "loop.wav").write_bytes(b"different")  # same name, different file
    backup = tmp_path / "A" / "Backup"; backup.mkdir()
    (backup / "loop.wav").write_bytes(b"old")

    paths = build_index([tmp_path])["loop.wav"]
    # both real copies are returned (so the caller can disambiguate); Backup skipped
    assert len(paths) == 2
    assert all("Backup" not in str(p) for p in paths)
