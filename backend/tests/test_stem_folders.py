"""Folders of stems with no project file show up as projects of their own."""
import wave
from pathlib import Path

from ablebackup.daws.registry import adapter_for_path
from ablebackup.daws.stemfolder import song_name
from ablebackup.scanner import find_projects, find_projects_progress, scan_one


def _wav(path: Path, seconds: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:  # tiny: 100 frames a second, 8-bit mono
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(100)
        w.writeframes(b"\x80" * int(seconds * 100))
    return path


def _stems(folder: Path, parts=("Kick", "Bass", "Vocals", "Synth Lead"), secs=184.0, prefix=""):
    for p in parts:
        _wav(folder / f"{prefix}{p}.wav", secs)
    return folder


def _found(root: Path) -> set[str]:
    plain = {str(p) for p in find_projects([root])}
    walked = {str(p) for p in find_projects_progress([root], stats={})}
    assert plain == walked  # both ways of looking agree
    return {str(Path(p).relative_to(root)) for p in plain}


def test_a_folder_of_stems_is_a_project(tmp_path):
    tmp_path = tmp_path / "Music"  # pytest's own folder name has "stems" in it
    _stems(tmp_path / "Night Drive Stems")
    _stems(tmp_path / "From Sam", prefix="Sunrise - ")
    assert _found(tmp_path) == {"Night Drive Stems", "From Sam"}
    scan = scan_one(tmp_path / "Night Drive Stems")
    assert scan.daw_id == "stems" and scan.name == "Night Drive"
    assert scan.project_dir == tmp_path / "Night Drive Stems"
    assert sorted(r.name for r in scan.refs) == ["Bass.wav", "Kick.wav", "Synth Lead.wav", "Vocals.wav"]
    assert all(r.exists and r.inside_project for r in scan.refs)
    assert scan.track_count == 4
    assert scan_one(tmp_path / "From Sam").name == "Sunrise"


def test_stems_in_sub_folders_are_one_project(tmp_path):
    tmp_path = tmp_path / "Music"  # pytest's own folder name has "stems" in it
    root = tmp_path / "Night Drive" / "Stems"
    _stems(root / "Drums", ("Kick", "Snare", "Hats"))
    _stems(root / "Music", ("Bass", "Pad", "Lead"))
    assert _found(tmp_path) == {"Night Drive/Stems"}
    scan = scan_one(root)
    assert scan.name == "Night Drive"
    assert "Drums/Kick.wav" in {r.resolved_path.relative_to(root).as_posix() for r in scan.refs}


def test_what_is_not_a_stems_folder(tmp_path):
    tmp_path = tmp_path / "Music"  # pytest's own folder name has "stems" in it
    # a sample pack: one-shots, however they're named
    _stems(tmp_path / "Vengeance House" / "Kicks", ("Kick 01", "Kick 02", "Kick 03"), secs=0.6)
    # an album: songs of different lengths
    for i, s in enumerate((200, 260, 315)):
        _wav(tmp_path / "Album" / f"Song {i}.wav", s)
    # named like stems but cut to different lengths
    for p, s in (("Kick", 30), ("Bass", 95), ("Vocals", 240)):
        _wav(tmp_path / "Odd" / f"{p}.wav", s)
    # samples Backups never treats as songs
    _stems(tmp_path / "Samples" / "Loops")
    # one sound only
    _wav(tmp_path / "Lonely Stems" / "Kick.wav", 180)
    assert _found(tmp_path) == set()


def test_a_projects_own_stems_stay_with_it(tmp_path):
    tmp_path = tmp_path / "Music"  # pytest's own folder name has "stems" in it
    proj = tmp_path / "Night Drive Project"
    proj.mkdir(parents=True)
    (proj / "Night Drive.als").write_bytes(b"x")
    _stems(proj / "Stems")
    _stems(proj / "Exports" / "Old Stems")
    # stems named after a project elsewhere: that project's, found as its exports
    _stems(tmp_path / "Exports" / "Night Drive Stems")
    found = _found(tmp_path)
    assert not any("Stems" in f for f in found)


def test_song_names():
    assert song_name(Path("/m/Night Drive Stems")) == "Night Drive"
    assert song_name(Path("/m/Night Drive (STEMS)")) == "Night Drive"
    assert song_name(Path("/m/Night Drive/Stems")) == "Night Drive"
    assert song_name(Path("/m/Stems/Night Drive")) == "Night Drive"
    assert song_name(Path("/m/Exports/Stems"), ["Night Drive 1-Kick.wav", "Night Drive 2-Bass.wav"]) == "Night Drive"
    assert song_name(Path("/m/From Sam"), ["Sunrise_Kick.wav", "Sunrise_Bass.wav"]) == "Sunrise"
    assert song_name(Path("/m/Sound Systems"), ["Kick.wav", "Bass.wav"]) == "Sound Systems"
    assert song_name(Path("/m/Sunrise Stems (from Sam)")) == "Sunrise (from Sam)"
    assert song_name(Path("/m/x/夜の高速道路 🦊 stems")) == "夜の高速道路 🦊"
    assert song_name(Path("/m/Night Drive [Stems]")) == "Night Drive"


def test_a_folder_is_read_by_the_stems_reader(tmp_path):
    tmp_path = tmp_path / "Music"  # pytest's own folder name has "stems" in it
    _stems(tmp_path / "S Stems")
    assert adapter_for_path(tmp_path / "S Stems").daw_id == "stems"
    assert adapter_for_path(tmp_path / "x.als").daw_id == "ableton"


# ---- the whole way through: scan, Library, Stems desk, backup, join -------------
import json
import time

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from tests.helpers import fileref_rel, write_als


def _library(c):
    return {p["name"]: p for p in c.get("/api/library").json()["projects"]}


def test_scan_library_desk_backup_and_join(tmp_path):
    src = tmp_path / "Music"
    folder = _stems(src / "Night Drive Stems")
    _wav(folder / "Night Drive.wav", 184.0)  # the full mix sits with its stems
    proj = src / "Sunrise Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Sunrise.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    dest = tmp_path / "Drive"
    dest.mkdir()
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        c.put("/api/settings", json={"sources": [str(src)], "dest": str(dest), "interval_minutes": 0})
        r = c.post("/api/scan", json={})
        assert sorted(p["name"] for p in r.json()["projects"]) == ["Night Drive", "Sunrise"]
        lib = _library(c)
        nd = lib["Night Drive"]
        assert nd["daw"] == "stems" and nd["tracks"] == 4
        desk = c.get(f"/api/stems/{nd['project_id']}").json()
        assert len(desk["sets"]) == 1
        s = desk["sets"][0]
        assert sorted(p["name"] for p in s["parts"]) == ["Bass", "Kick", "Synth Lead", "Vocals"]
        assert s["master"]["name"] == "Night Drive"

        # backed up like any project, each sound once
        job = c.post("/api/backup", json={}).json()["job_id"]
        for _ in range(200):
            st = c.get(f"/api/jobs/{job}").json()
            if st["state"] in ("done", "error"):
                break
            time.sleep(0.05)
        assert st["state"] == "done", st
        snaps = list((dest / "StemsBackups").rglob("manifest.json"))
        assert len(snaps) == 1
        man = json.loads(snaps[0].read_text())
        assert man["daw"] == "stems" and man["file_count"] == 5
        assert sorted(f["logical_path"] for f in man["files"]) == [
            "Bass.wav", "Kick.wav", "Night Drive.wav", "Synth Lead.wav", "Vocals.wav"]

        # they belong to Sunrise after all: the stems move there, Undo puts them back
        sun = lib["Sunrise"]["project_id"]
        j = c.post("/api/stem-folders/join", json={"project_id": nd["project_id"], "target_id": sun}).json()
        assert j["moved"] == 5 and j["project"] == "Sunrise"
        assert "Night Drive" not in _library(c)
        assert len(c.get(f"/api/stems/{sun}").json()["sets"][0]["parts"]) == 4
        c.post("/api/scan", json={})  # a later scan doesn't bring the folder back
        assert "Night Drive" not in _library(c)
        assert c.post("/api/stem-folders/join/undo", json={"token": j["token"]}).status_code == 200
        assert "Night Drive" in _library(c)
        assert c.get(f"/api/stems/{sun}").json()["sets"] == []
        assert len(c.get(f"/api/stems/{nd['project_id']}").json()["sets"][0]["parts"]) == 4


def test_the_phone_lists_a_stems_folders_stems(tmp_path, monkeypatch):
    from tests.test_phone import _pair, _setup
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    cat = app.state.catalog
    folder = _stems(tmp_path / "Music" / "Sunrise Stems", ("Kick", "Bass"), prefix="Sunrise - ")
    mix = _wav(folder / "Sunrise.wav", 184.0)
    cat.upsert_discovered([{"project_id": "s1", "name": "Sunrise", "path": str(folder), "dir": str(folder),
                            "daw": "stems", "owner": "me", "size": 0, "mtime": 2.0,
                            "missing_count": 0}], "2026-10-20_1200")
    for f, kind in ((folder / "Sunrise - Kick.wav", "stem"), (folder / "Sunrise - Bass.wav", "stem"), (mix, "song")):
        cat.link_export(str(f), "s1", f.stem, f.stat().st_size, 2.0, kind)
    desk.put("/api/phone", json={"enabled": True})
    me = _pair(desk, phone)
    listed = {p["name"]: p for p in me.get("/phone/projects")["projects"]}
    assert listed["Sunrise"]["daw"] == "stems" and listed["Sunrise"]["songs"] == 3
    songs = me.get("/phone/projects/s1")["songs"]
    assert [s["title"] for s in songs] == ["Sunrise", "Bass", "Kick"]  # the mix first


def test_stems_beside_several_saves_of_one_song_stay_with_it(tmp_path):
    tmp_path = tmp_path / "Music"
    proj = tmp_path / "Late Bus Project"
    proj.mkdir(parents=True)
    (proj / "Late Bus.als").write_bytes(b"x")
    (proj / "Late Bus v2.als").write_bytes(b"x")
    _stems(proj / "Stems")
    assert not any("Stems" in f for f in _found(tmp_path))
    # a folder of different songs still shows a stems folder of its own
    other = tmp_path / "Ideas"
    other.mkdir()
    (other / "Sunrise.als").write_bytes(b"x")
    (other / "Glasshouse.als").write_bytes(b"x")
    _stems(other / "Stems from Sam")
    assert "Ideas/Stems from Sam" in _found(tmp_path)
