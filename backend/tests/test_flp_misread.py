"""FL Studio projects the reader once misread: a user's project showed 3221226 BPM,
and garbled text for every sample and plugin name (268 "missing" samples). The
made-up files here are tiny but laid out like real ones: version first, then the
build number, a few settings, the tempo, channels with their plugin and sample."""
import sqlite3
import struct

from ablebackup.daws.flp import read_all, rewrite_sample_paths


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b, n = n & 0x7F, n >> 7
        out.append(b | 0x80 if n else b)
        if not n:
            return bytes(out)


def _text(eid: int, s: str, unicode: bool = True) -> bytes:
    payload = s.encode("utf-16-le") + b"\x00\x00" if unicode else s.encode("cp1252") + b"\x00"
    return bytes([eid]) + _varint(len(payload)) + payload


def _ascii(eid: int, s: str) -> bytes:
    payload = s.encode("ascii") + b"\x00"
    return bytes([eid]) + _varint(len(payload)) + payload


def _dword(eid: int, v: int) -> bytes:
    return bytes([eid]) + struct.pack("<I", v)


def _word(eid: int, v: int) -> bytes:
    return bytes([eid]) + struct.pack("<H", v)


def _flp(events: bytes, before: bytes = b"") -> bytes:
    body = before + events
    return (b"FLhd" + struct.pack("<I", 6) + struct.pack("<HHH", 0, 2, 96)
            + b"FLdt" + struct.pack("<I", len(body)) + body)


def _modern(tempo_milli: int = 140_000, fl26: bool = False) -> bytes:
    # FL Studio 26 writes event 172 with a ONE-byte value, though ids 128-191 are
    # four-byte events everywhere else: the cause of the 3221226 BPM report.
    return (_ascii(199, "26.1.5.5618" if fl26 else "24.2.1.4526") + _dword(159, 4526)
            + bytes([28, 1]) + (bytes([172, 1, 1, 0]) if fl26 else bytes([37, 1]))
            + _dword(156, tempo_milli) + _word(64, 0)
            + _text(201, "Serum") + _text(196, "C:\\Splice\\Raven Kick.wav")
            + _text(201, "") + _text(201, "Fruity Limiter")
            + _text(196, "D:\\Samples\\Vox Chop 03.wav")
            # a big binary blob (playlist data) full of bytes that look like events
            + bytes([233]) + _varint(64) + bytes([196, 201, 156, 0x10, 0x02, 0, 0xC0] * 9 + [0]))


def test_newer_project_reads_tempo_samples_and_plugins(tmp_path):
    flp = tmp_path / "Im a Raven.flp"
    flp.write_bytes(_flp(_modern()))
    paths, meta = read_all(flp)
    assert paths == ["C:\\Splice\\Raven Kick.wav", "D:\\Samples\\Vox Chop 03.wav"]
    assert meta["tempo"] == 140.0
    assert meta["plugins"] == ["Serum", "Fruity Limiter"]


def test_fl_studio_26_project(tmp_path):
    flp = tmp_path / "Im a Raven.flp"
    flp.write_bytes(_flp(_modern(fl26=True) + bytes([172, 0, 1, 0, 0, 0])))
    paths, meta = read_all(flp)
    assert paths == ["C:\\Splice\\Raven Kick.wav", "D:\\Samples\\Vox Chop 03.wav"]
    assert meta["tempo"] == 140.0
    assert meta["plugins"] == ["Serum", "Fruity Limiter"]
    # a backup's portable copy keeps FL 26's layout and only changes the path
    data = rewrite_sample_paths(flp, lambda s: "_External/Raven Kick.wav" if "Kick" in s else None)
    copy = tmp_path / "copy.flp"
    copy.write_bytes(data)
    assert read_all(copy)[0] == ["_External/Raven Kick.wav", "D:\\Samples\\Vox Chop 03.wav"]
    assert read_all(copy)[1]["tempo"] == 140.0


def test_project_the_reader_loses_its_place_in_is_read_properly(tmp_path):
    # Bytes before the version event threw every later event off, so the tempo came
    # out as 3221226 and names as garbled text. Now the read starts again at the
    # version and gets the real values.
    for stray in (b"\xd5", b"\xe9\x02", b"\x9c\x10\x02\x00", b"\xc4\x83\x00\x00\x01\x02"):
        flp = tmp_path / "Im a Raven.flp"
        flp.write_bytes(_flp(_modern(), before=stray))
        paths, meta = read_all(flp)
        assert paths == ["C:\\Splice\\Raven Kick.wav", "D:\\Samples\\Vox Chop 03.wav"], stray
        assert meta["tempo"] == 140.0
        assert meta["plugins"] == ["Serum", "Fruity Limiter"]


def test_unfollowable_project_shows_no_garbage(tmp_path):
    # No version to start again from: only clearly real names are kept, never a
    # made-up tempo or random bytes shown as sample names.
    junk = bytes((i * 73 + 41) % 256 for i in range(3000))
    events = (b"\xd5\xff\xff\x03" + junk + _text(196, "C:\\Splice\\Raven Kick.wav")
              + junk + _text(201, "Serum") + junk)
    flp = tmp_path / "broken.flp"
    flp.write_bytes(_flp(events))
    paths, meta = read_all(flp)
    assert paths == ["C:\\Splice\\Raven Kick.wav"]
    assert meta["plugins"] == ["Serum"]
    assert meta["tempo"] is None
    # ...and a backup copies such a file exactly as it is
    assert rewrite_sample_paths(flp, lambda s: "_External/x.wav") is None


def test_impossible_tempo_is_blank(tmp_path):
    flp = tmp_path / "beat.flp"
    flp.write_bytes(_flp(_modern(tempo_milli=0xC0000210)))   # = 3221226 BPM
    assert read_all(flp)[1]["tempo"] is None


def test_old_fl_project_text_and_tempo(tmp_path):
    # FL 11 and earlier save names as plain 8-bit text (read as UTF-16 they came out
    # as Chinese-looking characters) and the tempo as whole + fine parts.
    events = (_ascii(199, "10.0.9") + _word(66, 128) + _word(93, 500)
              + _text(201, "Sytrus", unicode=False)
              + _text(196, "C:\\Program Files\\Image-Line\\Packs\\Café Snare.wav", unicode=False))
    flp = tmp_path / "old.flp"
    flp.write_bytes(_flp(events))
    paths, meta = read_all(flp)
    assert paths == ["C:\\Program Files\\Image-Line\\Packs\\Café Snare.wav"]
    assert meta["plugins"] == ["Sytrus"]
    assert meta["tempo"] == 128.5
    # a backup rewrites an old project's paths in its own 8-bit text
    data = rewrite_sample_paths(flp, lambda s: "_External/Café Snare.wav")
    assert b"_External/Caf\xe9 Snare.wav\x00" in data
    flp.write_bytes(data)
    assert read_all(flp)[0] == ["_External/Café Snare.wav"]


def test_impossible_stored_bpm_is_cleared(tmp_path):
    from ablebackup.catalog import Catalog
    db = tmp_path / "catalog.db"
    cat = Catalog(db)
    cat.upsert_discovered([{"project_id": "a", "name": "Im a Raven", "path": "/x/a.flp",
                            "dir": "/x", "daw": "flstudio", "owner": "system", "size": 1,
                            "mtime": 1.0, "missing_count": 0, "bpm": 3221226.0},
                           {"project_id": "b", "name": "Fine", "path": "/x/b.flp",
                            "dir": "/x", "daw": "flstudio", "owner": "system", "size": 1,
                            "mtime": 1.0, "missing_count": 0, "bpm": 174.0}], "now")
    con = sqlite3.connect(db)
    assert dict(con.execute("SELECT name, bpm FROM discovered")) == {"Im a Raven": None, "Fine": 174.0}
    # a value an older version stored is cleared when the app next opens
    con.execute("UPDATE discovered SET bpm = 3221226 WHERE project_id = 'a'")
    con.commit()
    Catalog(db)
    assert con.execute("SELECT bpm FROM discovered WHERE project_id = 'a'").fetchone()[0] is None
