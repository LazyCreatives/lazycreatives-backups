"""Portable backups must round-trip for EVERY DAW: external samples are gathered
into the snapshot, the project copy is rewritten to point at them, and the
verifier proves the snapshot is self-contained (portable_ok)."""
import struct
import zipfile

from ablebackup.backup_engine import backup_project
from ablebackup.scanner import scan_one
from ablebackup.verifier import verify_snapshot
from tests.helpers import fileref_abs, write_als


def _external_sample(tmp_path, name="kick.wav", data=b"kick-bytes"):
    lib = tmp_path / "library"
    lib.mkdir(exist_ok=True)
    p = lib / name
    p.write_bytes(data)
    return p


def _flp_bytes(paths: list[str]) -> bytes:
    from ablebackup.daws.flp import _varint
    flhd = b"FLhd" + struct.pack("<I", 6) + struct.pack("<HHH", 0, 1, 96)
    events = b""
    for s in paths:
        payload = s.encode("utf-16-le") + b"\x00\x00"
        events += bytes([196]) + _varint(len(payload)) + payload
    return flhd + b"FLdt" + struct.pack("<I", len(events)) + events


def _assert_portable(snapshot_dir, deep=True):
    res = verify_snapshot(snapshot_dir, deep=deep)
    assert res["ok"], res
    assert res["portable_ok"] is True, res["portable_missing"]
    assert (snapshot_dir / "_External" / "kick.wav").is_file()
    return res


def test_ableton_portable_roundtrip(tmp_path):
    sample = _external_sample(tmp_path)
    proj = tmp_path / "Song Project"; proj.mkdir()
    write_als(proj / "Song.als", [fileref_abs(str(sample), sample.name)])
    res = backup_project(scan_one(proj / "Song.als"),
                         tmp_path / "NAS" / "AbletonBackups", "t", portable=True)
    _assert_portable(res.snapshot_dir)


def test_reaper_portable_roundtrip(tmp_path):
    sample = _external_sample(tmp_path)
    proj = tmp_path / "Session"; proj.mkdir()
    (proj / "Mix.rpp").write_text(
        f'<REAPER_PROJECT 0.1\n  TEMPO 142 4 4\n  <TRACK\n    <ITEM\n      <SOURCE WAVE\n'
        f'        FILE "{sample}"\n      >\n    >\n  >\n>\n')
    res = backup_project(scan_one(proj / "Mix.rpp"),
                         tmp_path / "NAS" / "ReaperBackups", "t", portable=True)
    _assert_portable(res.snapshot_dir)
    text = (res.snapshot_dir / "Mix.rpp").read_text()
    assert '"_External/kick.wav"' in text and str(sample) not in text


def test_flstudio_portable_roundtrip(tmp_path):
    sample = _external_sample(tmp_path)
    proj = tmp_path / "Beats"; proj.mkdir()
    (proj / "Banger.flp").write_bytes(_flp_bytes([str(sample)]))
    res = backup_project(scan_one(proj / "Banger.flp"),
                         tmp_path / "NAS" / "FLStudioBackups", "t", portable=True)
    _assert_portable(res.snapshot_dir)
    # The rewritten .flp parses and now references the snapshot-relative copy.
    from ablebackup.daws.flp import read_sample_paths
    assert read_sample_paths(res.snapshot_dir / "Banger.flp") == ["_External/kick.wav"]


def test_dawproject_portable_roundtrip(tmp_path):
    sample = _external_sample(tmp_path)
    proj = tmp_path / "BitwigStuff"; proj.mkdir()
    xml = (f'<Project version="1.0"><Structure><Track name="T1"/></Structure>'
           f'<Arrangement><Audio><File path="{sample}"/></Audio></Arrangement></Project>')
    with zipfile.ZipFile(proj / "Tune.dawproject", "w") as z:
        z.writestr("project.xml", xml)
        z.writestr("samples/embedded.wav", b"embedded-bytes")
    res = backup_project(scan_one(proj / "Tune.dawproject"),
                         tmp_path / "NAS" / "DAWprojectBackups", "t", portable=True)
    _assert_portable(res.snapshot_dir)
    with zipfile.ZipFile(res.snapshot_dir / "Tune.dawproject") as z:
        rewritten = z.read("project.xml").decode("utf-8")
        assert 'path="_External/kick.wav"' in rewritten
        assert z.read("samples/embedded.wav") == b"embedded-bytes"  # rode along intact


def test_portable_metadata_survives_scan(tmp_path):
    # The same scan that powers backups carries the display metadata.
    sample = _external_sample(tmp_path)
    proj = tmp_path / "Session"; proj.mkdir()
    (proj / "Mix.rpp").write_text(
        f'<REAPER_PROJECT 0.1\n  TEMPO 142 4 4\n  <TRACK\n    <VST "VST3: Pro-Q 3 (FabFilter)" proq3.vst3 0 "" 1 ""\n    >\n  >\n  <TRACK\n  >\n  <SOURCE WAVE\n    FILE "{sample}"\n  >\n>\n')
    scan = scan_one(proj / "Mix.rpp")
    assert scan.tempo == 142.0
    assert scan.track_count == 2
    assert scan.plugins == ["Pro-Q 3 (FabFilter)"]
