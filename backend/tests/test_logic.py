"""Logic Pro adapter: a .logicx package is ONE project (never thousands of files),
every file inside it is backed up keeping its layout, outside audio is gathered,
gone audio is reported missing, and tempo/key/tracks come from MetaData.plist."""
import os
import plistlib
import time

from ablebackup.backup_engine import backup_project
from ablebackup.daws.logic import LogicAdapter
from ablebackup.daws.registry import adapter_for_id, adapter_for_path
from ablebackup.scanner import find_projects, find_projects_progress, scan_one, scan_projects
from ablebackup.verifier import verify_snapshot


def make_logicx(parent, name="Night Drive", audio=(), meta=None, alternatives=("000",),
                inside_audio=("Vox#01.wav",), undo=True):
    """A small fake Logic Pro package shaped like the real thing."""
    pkg = parent / f"{name}.logicx"
    for alt in alternatives:
        a = pkg / "Alternatives" / alt
        a.mkdir(parents=True)
        (a / "ProjectData").write_bytes(b"\x00LOGIC-PROJECT-DATA" + alt.encode())
        (a / "DisplayState.plist").write_bytes(plistlib.dumps({"x": 1}))
        md = {"BeatsPerMinute": 124.0, "SongKey": "A", "SongGenderKey": "minor",
              "NumberOfTracks": 9, "SampleRate": 44100, "AudioFiles": list(audio)}
        md.update(meta or {})
        (a / "MetaData.plist").write_bytes(plistlib.dumps(md, fmt=plistlib.FMT_BINARY))
        if undo:
            u = a / "Undo Data.nosync"
            u.mkdir()
            (u / "UndoData.0").write_bytes(b"x" * 1000)
    (pkg / "Resources").mkdir()
    (pkg / "Resources" / "ProjectInformation.plist").write_bytes(plistlib.dumps({"v": 1}))
    if inside_audio:
        media = pkg / "Media" / "Audio Files"
        media.mkdir(parents=True)
        for n in inside_audio:
            (media / n).write_bytes(b"inside-audio-" + n.encode())
    (pkg / ".DS_Store").write_bytes(b"junk")
    return pkg


def test_registered_by_folder_extension():
    assert adapter_for_path("/Music/Logic/Song.logicx").daw_id == "logic"
    assert adapter_for_path("/Music/Old/Song.logic").daw_id == "logic"
    assert adapter_for_id("logic").display_name == "Logic Pro"


def test_package_is_one_project_and_never_walked_into(tmp_path):
    make_logicx(tmp_path, "Night Drive")
    make_logicx(tmp_path / "Sub", "Sunrise")
    # an Ableton project inside a Logic package must not be found as its own project
    found = LogicAdapter().discover_projects([tmp_path])
    assert sorted(p.name for p in found) == ["Night Drive.logicx", "Sunrise.logicx"]
    assert sorted(p.name for p in find_projects([tmp_path])) == ["Night Drive.logicx", "Sunrise.logicx"]
    assert sorted(p.name for p in find_projects_progress([tmp_path])) == \
        ["Night Drive.logicx", "Sunrise.logicx"]


def test_scan_reads_tempo_key_tracks_and_inside_files(tmp_path):
    pkg = make_logicx(tmp_path, "Night Drive")
    scan = scan_one(pkg)
    assert scan.daw_id == "logic"
    assert scan.name == "Night Drive"
    assert scan.tempo == 124.0
    assert scan.track_count == 9
    names = {r.name for r in scan.refs}
    assert {"ProjectData", "MetaData.plist", "ProjectInformation.plist", "Vox#01.wav"} <= names
    assert "UndoData.0" not in names and ".DS_Store" not in names  # caches + junk left out
    assert not scan.missing
    assert all(r.inside_project for r in scan.refs)
    _, meta = LogicAdapter().parse_with_meta(pkg)
    assert meta["key"] == "A minor"


def test_outside_audio_gathered_and_gone_audio_reported(tmp_path):
    ext = tmp_path / "Samples" / "kick.wav"
    ext.parent.mkdir()
    ext.write_bytes(b"kick")
    folder_proj = tmp_path / "Proj"
    folder_proj.mkdir()
    (folder_proj / "Audio Files").mkdir()
    (folder_proj / "Audio Files" / "bass.wav").write_bytes(b"bass")
    pkg = make_logicx(folder_proj, "Night Drive", audio=[
        str(ext),                       # absolute, outside
        "Audio Files/bass.wav",         # project saved as a folder: next to the package
        "Audio Files/Vox#01.wav",       # inside the package: already backed up with it
        "Audio Files/gone.wav",         # listed but gone -> missing
    ], meta={"SamplerInstrumentsFiles": ["/Library/Application Support/Logic/nope.wav"]})
    scan = scan_one(pkg)
    present = {r.name for r in scan.refs if r.exists}
    assert {"kick.wav", "bass.wav", "Vox#01.wav"} <= present
    assert [r.name for r in scan.missing] == ["gone.wav"]   # factory content never "missing"
    assert sum(1 for r in scan.refs if r.name == "Vox#01.wav") == 1


def test_newest_alternative_drives_metadata(tmp_path):
    pkg = make_logicx(tmp_path, "Alt", alternatives=("000", "001"))
    newer = pkg / "Alternatives" / "001"
    (newer / "MetaData.plist").write_bytes(plistlib.dumps({"BeatsPerMinute": 90}))
    old = time.time() - 3600
    os.utime(pkg / "Alternatives" / "000" / "ProjectData", (old, old))
    assert scan_one(pkg).tempo == 90.0
    names = [r.relative_path for r in LogicAdapter().parse_project(pkg)]
    assert "Alt.logicx/Alternatives/000/ProjectData" in names  # every alternative kept
    assert "Alt.logicx/Alternatives/001/ProjectData" in names


def test_not_a_logic_package_is_skipped(tmp_path):
    (tmp_path / "Fake.logicx").mkdir()
    (tmp_path / "Fake.logicx" / "readme.txt").write_text("hi")
    assert scan_projects([tmp_path]) == []


def test_backup_restores_a_package_logic_can_open_and_verifies(tmp_path):
    ext = tmp_path / "Samples" / "kick.wav"
    ext.parent.mkdir()
    ext.write_bytes(b"kick")
    src = tmp_path / "Music"
    src.mkdir()
    pkg = make_logicx(src, "Night Drive", audio=[str(ext)])
    scan = scan_one(pkg)
    res = backup_project(scan, tmp_path / "dest", "2026-10-05_1200")
    snap = res.snapshot_dir
    assert (snap / "Night Drive.logicx" / "Alternatives" / "000" / "ProjectData").is_file()
    assert (snap / "Night Drive.logicx" / "Media" / "Audio Files" / "Vox#01.wav").is_file()
    assert (snap / "_External" / "kick.wav").is_file()
    assert not (snap / "Night Drive.logicx" / "Alternatives" / "000" / "Undo Data.nosync").exists()
    v = verify_snapshot(snap)
    assert v["ok"], v
    assert v["checked"] == res.file_count


def test_scan_projects_mixes_logic_with_other_daws(tmp_path):
    make_logicx(tmp_path, "Night Drive")
    (tmp_path / "beat.rpp").write_text("<REAPER_PROJECT\n>\n")
    got = {(p.name, p.daw_id) for p in scan_projects([tmp_path])}
    assert ("Night Drive", "logic") in got
    assert ("beat", "reaper") in got


def test_saved_time_is_newest_file_inside(tmp_path):
    pkg = make_logicx(tmp_path, "Night Drive")
    old = time.time() - 86400
    os.utime(pkg, (old, old))
    scan = scan_one(pkg)
    assert scan.mtime > old + 3600
    assert scan.size == 0 and scan.total_size > 0


def test_exports_never_come_from_inside_a_package(tmp_path):
    from ablebackup.exports import _audio_files
    proj = tmp_path / "Logic"
    proj.mkdir()
    make_logicx(proj, "Night Drive", inside_audio=("take.wav",))
    (proj / "Bounces").mkdir()
    (proj / "Bounces" / "Night Drive.wav").write_bytes(b"song")
    got = [p.name for p in _audio_files(proj, 3, skip_samples=False)]
    assert got == ["Night Drive.wav"]


def test_backed_up_logic_snapshot_gets_its_tempo_for_genre(tmp_path):
    from ablebackup.service import _genre_for_snapshot
    pkg = make_logicx(tmp_path / "src", "Night Drive")
    res = backup_project(scan_one(pkg), tmp_path / "dest", "2026-10-05_1200")
    assert _genre_for_snapshot(res.snapshot_dir, "Night Drive")["bpm"] == 124.0
