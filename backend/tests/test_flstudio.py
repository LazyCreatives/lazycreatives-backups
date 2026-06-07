import struct

import pytest


def _make_flp(paths: list[str]) -> bytes:
    """A minimal valid .flp: FLhd header + FLdt with one SamplePath (196) event per path."""
    flhd = b"FLhd" + struct.pack("<I", 6) + struct.pack("<HHH", 0, 1, 96)
    events = b""
    for p in paths:
        payload = p.encode("utf-16-le") + b"\x00\x00"
        length, ln = len(payload), b""
        while True:
            b = length & 0x7F
            length >>= 7
            ln += bytes([b | 0x80]) if length else bytes([b])
            if not length:
                break
        events += bytes([196]) + ln + payload
    return flhd + b"FLdt" + struct.pack("<I", len(events)) + events


def test_reader_extracts_user_samples_excludes_factory_and_dups(tmp_path):
    from ablebackup.daws.flp import read_sample_paths
    flp = tmp_path / "beat.flp"
    flp.write_bytes(_make_flp([
        "/Users/me/Splice/kick.wav",
        "%FLStudioFactoryData%/Drums/clap.wav",  # factory -> excluded
        "/Users/me/Splice/kick.wav",             # duplicate
        "C:\\packs\\snare.wav",
    ]))
    assert read_sample_paths(flp) == ["/Users/me/Splice/kick.wav", "C:\\packs\\snare.wav"]


def test_adapter_parse_project(tmp_path):
    from ablebackup.daws.flstudio import FlStudioAdapter
    flp = tmp_path / "beat.flp"
    flp.write_bytes(_make_flp(["/x/loop.wav"]))
    refs = FlStudioAdapter().parse_project(flp)
    assert len(refs) == 1
    assert refs[0].name == "loop.wav"
    assert refs[0].absolute_path == "/x/loop.wav"
    assert refs[0].size == 0  # FL records no size


def test_unparseable_flp_raises(tmp_path):
    from ablebackup.daws.flstudio import FlStudioAdapter
    bad = tmp_path / "broken.flp"
    bad.write_bytes(b"not a real flp file")
    with pytest.raises(ValueError):
        FlStudioAdapter().parse_project(bad)


def test_scan_one_dispatches_flp_via_registry(tmp_path):
    from ablebackup.scanner import scan_one
    proj = tmp_path / "Beat Project"
    proj.mkdir()
    (proj / "loop.wav").write_bytes(b"audio")
    flp = proj / "Beat.flp"
    flp.write_bytes(_make_flp([str(proj / "loop.wav")]))

    scan = scan_one(flp)
    assert scan.daw_id == "flstudio"
    assert scan.name == "Beat"
    assert sum(1 for r in scan.refs if r.exists) == 1
