"""Bitwig adapter: a native .bwproject is found, the audio it lists is followed, its
autosaved copies are not projects of their own, tempo and plug-ins are read, and a
backup verifies. The made-up files below are laid out byte for byte like projects
saved by Bitwig 1.3 to 4.3 (checked against real ones while building this)."""
import struct
from pathlib import Path

from ablebackup.backup_engine import backup_project
from ablebackup.daws.bitwig import BitwigAdapter, read_meta, read_tempo
from ablebackup.daws.registry import adapter_for_id, adapter_for_path
from ablebackup.exports import match_exports
from ablebackup.scanner import find_projects, find_projects_progress, scan_one, scan_projects
from ablebackup.verifier import verify_snapshot


def _u32(n: int) -> bytes:
    return n.to_bytes(4, "big")


def _text(s: str) -> bytes:
    b = s.encode()
    return _u32(len(b)) + b


def _field(key: str, kind: int, value: bytes) -> bytes:
    return _u32(1) + _text(key) + bytes([kind]) + value


def bwproject_bytes(used_files=(), tempo=128.0, plugins=(), utf16_title=False) -> bytes:
    meta = _u32(4) + _text("meta")
    meta += _field("application_version_name", 0x08, _text("4.3.2"))
    meta += _field("comment", 0x08, _text(""))
    meta += _field("creator", 0x08, _text("Rob"))
    meta += _field("genre", 0x08, _text("House"))
    meta += _field("referenced_packaged_file_ids", 0x19,
                   _u32(1) + _text("Bitwig/Essentials:1/samples/Kick 1.wav"))
    meta += _field("revision_no", 0x03, _u32(116506))
    meta += _field("structure", 0x0D, _u32(6) + b"BtWg00")
    if utf16_title:
        t = "Café".encode("utf-16-be")
        meta += _field("title", 0x08, _u32(0x80000000 | 4) + t)
    meta += _field("type", 0x08, _text("application/bitwig-project"))
    meta += _field("used_files", 0x19, _u32(len(used_files)) + b"".join(_text(f) for f in used_files))
    meta += _u32(0)
    body = b"\x09\x00\x00\x00\xd7"                          # transport
    body += b"\x00\x00\x18\x32\x0a"                        # some other field
    body += b"\x00\x00\x02\x11\x09\x00\x00\x04\xc1"        # .tempo -> tempo object
    body += b"\x00\x00\x02\x5f\x01\x00"
    body += b"\x00\x00\x02\xc8\x07" + struct.pack(">d", tempo)
    for p in plugins:
        body += b"\x00\x00\x12\x9f\x08" + _text(p)
    body += b"\x00\x00\x1d\x41\x08" + _text("C:\\Program Files\\Bitwig Studio\\Library\\devices\\EQ-2.bwdevice")
    return b"BtWg0003000200b300001688000000000000000000" + meta + b" " * 64 + b"\n" + body


def make_project(folder: Path, name="Night Drive", used=("samples/Kick.wav", "recordings/Vox-1.wav"),
                 extra_used=(), tempo=128.0, plugins=(), make_files=True) -> Path:
    """A project folder like Bitwig makes: Name/Name.bwproject plus its audio folders."""
    folder.mkdir(parents=True, exist_ok=True)
    if make_files:
        for rel in used:
            f = folder / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(b"audio-" + rel.encode())
    (folder / ".bitwig-project").write_bytes(b"")
    proj = folder / f"{name}.bwproject"
    proj.write_bytes(bwproject_bytes(list(used) + list(extra_used), tempo, plugins))
    return proj


def test_registered_by_extension():
    assert adapter_for_path("/Music/Night Drive/Night Drive.bwproject").daw_id == "bitwig"
    assert adapter_for_id("bitwig").display_name == "Bitwig Studio"


def test_meta_block_reads_named_fields():
    meta = read_meta(bwproject_bytes(["samples/a.wav"], utf16_title=True))
    assert meta["used_files"] == ["samples/a.wav"]
    assert meta["genre"] == "House"
    assert meta["revision_no"] == 116506
    assert meta["title"] == "Café"
    assert "structure" not in meta                     # nested block skipped whole


def test_scan_reads_tempo_plugins_and_used_audio(tmp_path):
    proj = make_project(tmp_path / "Bitwig Studio" / "Projects" / "Night Drive", tempo=172.0,
                        plugins=["/Library/Audio/Plug-Ins/VST3/Serum.vst3",
                                 "C:\\Program Files\\Common Files\\VST3\\iZotope\\Ozone 8 Elements.vst3",
                                 "Kontakt 5.dll", "/Library/Audio/Plug-Ins/VST3/Serum.vst3"])
    scan = scan_one(proj)
    assert scan.daw_id == "bitwig"
    assert scan.name == "Night Drive"
    assert scan.tempo == 172.0
    assert scan.track_count is None                    # not readable from the file
    assert scan.plugins == ["Serum", "Ozone 8 Elements", "Kontakt 5"]
    assert {r.name for r in scan.refs} == {"Kick.wav", "Vox-1.wav", ".bitwig-project"}
    assert not scan.missing
    assert all(r.inside_project for r in scan.refs)


def test_outside_audio_gathered_and_gone_audio_reported(tmp_path):
    ext = tmp_path / "Splice" / "snare.wav"
    ext.parent.mkdir()
    ext.write_bytes(b"snare")
    proj = make_project(tmp_path / "Night Drive", extra_used=[str(ext), "bounce/Bass-bounce-1.wav"])
    scan = scan_one(proj)
    assert {r.name for r in scan.refs if r.exists} == {"Kick.wav", "Vox-1.wav", "snare.wav",
                                                       ".bitwig-project"}
    assert [r.name for r in scan.missing] == ["Bass-bounce-1.wav"]


def test_plugin_states_ride_along(tmp_path):
    proj = make_project(tmp_path / "Night Drive")
    states = proj.parent / "plugin-states"
    states.mkdir()
    (states / "Serum-3f2a.fxb").write_bytes(b"state")
    scan = scan_one(proj)
    assert "Serum-3f2a.fxb" in {r.name for r in scan.refs}


def test_auto_backups_are_not_projects(tmp_path):
    proj = make_project(tmp_path / "Night Drive")
    ab = proj.parent / "auto-backups" / "Night Drive"
    ab.mkdir(parents=True)
    (ab / "Night Drive [2026-10-05 120000].bwproject").write_bytes(proj.read_bytes())
    want = [proj]
    assert BitwigAdapter().discover_projects([tmp_path]) == want
    assert [p for p in find_projects([tmp_path]) if p.suffix == ".bwproject"] == want
    assert find_projects_progress([tmp_path]) == want


def test_other_bwproject_files_are_skipped(tmp_path):
    (tmp_path / "not-bitwig.bwproject").write_bytes(b"hello")
    assert scan_projects([tmp_path]) == []


def test_damaged_file_keeps_what_was_read():
    data = bwproject_bytes(["samples/a.wav"])
    assert read_meta(data[:300])                       # cut short: no crash
    assert read_tempo(b"BtWg nothing here") is None


def test_backup_keeps_project_and_audio_and_verifies(tmp_path):
    ext = tmp_path / "Splice" / "snare.wav"
    ext.parent.mkdir()
    ext.write_bytes(b"snare")
    proj = make_project(tmp_path / "Projects" / "Night Drive", extra_used=[str(ext)])
    res = backup_project(scan_one(proj), tmp_path / "dest", "2026-10-05_1400", portable=True)
    snap = res.snapshot_dir
    assert (snap / "Night Drive.bwproject").read_bytes() == proj.read_bytes()
    assert (snap / "samples" / "Kick.wav").is_file()
    assert (snap / "recordings" / "Vox-1.wav").is_file()
    assert (snap / ".bitwig-project").is_file()
    assert (snap / "_External" / "snare.wav").is_file()
    v = verify_snapshot(snap)
    assert v["ok"], v


def test_exports_skip_bitwig_ingredients_but_find_the_song(tmp_path):
    proj = make_project(tmp_path / "Night Drive", used=("samples/Kick.wav", "recordings/Vox-1.wav",
                                                         "bounce/Bass-bounce-1.wav"))
    out = proj.parent / "exported" / "2026-10-05 140000"
    out.mkdir(parents=True)
    (out / "Night Drive.wav").write_bytes(b"song")
    rows = match_exports([{"project_id": "p1", "name": "Night Drive", "dir": str(proj.parent)}])
    assert [Path(r["path"]).name for r in rows] == ["Night Drive.wav"]


def test_bounce_folder_still_counts_outside_bitwig(tmp_path):
    """"Bounce" is a usual name for a folder of finished songs in other programs."""
    d = tmp_path / "Night Drive Project"
    (d / "Bounce").mkdir(parents=True)
    (d / "Night Drive.als").write_bytes(b"")
    (d / "Bounce" / "Night Drive.wav").write_bytes(b"song")
    rows = match_exports([{"project_id": "p1", "name": "Night Drive", "dir": str(d)}])
    assert [Path(r["path"]).name for r in rows] == ["Night Drive.wav"]


def test_scan_projects_mixes_bitwig_with_other_daws(tmp_path):
    make_project(tmp_path / "Night Drive")
    (tmp_path / "beat.rpp").write_text("<REAPER_PROJECT\n>\n")
    got = {(p.name, p.daw_id) for p in scan_projects([tmp_path])}
    assert ("Night Drive", "bitwig") in got
    assert ("beat", "reaper") in got
