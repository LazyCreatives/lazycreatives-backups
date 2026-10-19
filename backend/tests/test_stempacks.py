"""Stem sets (grouping, line-up check, matching song) and stem pack zips."""
import os
import wave
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup import stempacks
from ablebackup.api.app import create_app


def _wav(path: Path, seconds: float, rate: int = 44100, bits: int = 24, when: float | None = None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(bits // 8)
        w.setframerate(rate)
        w.writeframes(b"\0" * int(seconds * rate) * 2 * (bits // 8))
    if when is not None:
        os.utime(path, (when, when))
    return path


def _row(p: Path, kind: str):
    st = p.stat()
    return {"path": str(p), "name": p.name, "kind": kind, "size": st.st_size, "mtime": st.st_mtime}


T = 1_760_000_000


def test_part_names():
    assert stempacks.part_name("Night Drive 3-Kick.wav", "Night Drive") == "Kick"
    assert stempacks.part_name("Night Drive - Lead Vocals.wav", "Night Drive") == "Lead Vocals"
    assert stempacks.part_name("Night Drive (Bass).wav", "Night Drive") == "Bass"
    assert stempacks.part_name("Night Drive Pads.wav", "Night Drive") == "Pads"
    assert stempacks.part_name("Night Drive 12-808 Sub.wav", "Night Drive") == "808 Sub"
    assert stempacks.part_name("Kick.wav", "Night Drive") == "Kick"


def test_audio_info_reads_the_header(tmp_path):
    i = stempacks.audio_info(str(_wav(tmp_path / "a.wav", 1.0, rate=48000, bits=16)))
    assert i["rate"] == 48000 and i["bits"] == 16 and i["channels"] == 2
    assert abs(i["seconds"] - 1.0) < 0.01


def test_sets_group_by_folder_and_time_and_find_the_song(tmp_path):
    rows = [
        _row(_wav(tmp_path / "Stems" / "Song 1-Kick.wav", 1, when=T), "stem"),
        _row(_wav(tmp_path / "Stems" / "Song 2-Bass.wav", 1, when=T + 60), "stem"),
        # a later export a day on: a second set
        _row(_wav(tmp_path / "Stems" / "Song 1-Kick (2).wav", 1, when=T + 86400), "stem"),
        _row(_wav(tmp_path / "Song master.wav", 1, when=T + 30), "song"),
        _row(_wav(tmp_path / "Song v2 master.wav", 1, when=T + 86400 + 30), "song"),
        _row(_wav(tmp_path / "Song Instrumental.wav", 1, when=T + 40), "song"),
    ]
    sets = stempacks.stem_sets(rows, "Song")
    assert [len(s["parts"]) for s in sets] == [1, 2]  # newest first
    old = sets[1]
    assert [p["part"] for p in old["parts"]] == ["Kick", "Bass"]
    assert old["master"]["name"] == "Song master.wav"
    assert old["instrumental"]["name"] == "Song Instrumental.wav"
    assert sets[0]["master"]["name"] == "Song v2 master.wav"
    assert old["check"]["ok"]


def test_check_flags_parts_that_dont_line_up(tmp_path):
    rows = [
        _row(_wav(tmp_path / "Stems" / "Song 1-Kick.wav", 1.0, when=T), "stem"),
        _row(_wav(tmp_path / "Stems" / "Song 2-Bass.wav", 2.0, rate=48000, bits=16, when=T), "stem"),
    ]
    c = stempacks.stem_sets(rows, "Song")[0]["check"]
    assert not c["ok"]
    assert len(c["problems"]) == 3  # length, sample rate, bit depth


def test_pack_zips_song_stems_and_sheet_and_leaves_originals(tmp_path):
    src = tmp_path / "src"
    rows = [
        _row(_wav(src / "Stems" / "Song 1-Kick.wav", 1, when=T), "stem"),
        _row(_wav(src / "Other" / "Song 1-Kick.wav", 1, when=T + 5), "stem"),
        _row(_wav(src / "Song master.wav", 1, when=T), "song"),
    ]
    before = {p: (p.stat().st_mtime, p.read_bytes()) for p in src.rglob("*.wav")}
    s = stempacks.stem_sets(rows, "Song")[0]
    out = tmp_path / "out"
    out.mkdir()
    project = {"name": "Song", "bpm": 124.0, "music_key": "A minor", "genre": "House"}
    path = Path(stempacks.make_pack(project, s, str(out)))
    assert path.parent == out and path.name.startswith("Song stems (")
    names = zipfile.ZipFile(path).namelist()
    base = path.stem
    assert f"{base}/About this song.txt" in names
    assert f"{base}/Song master.wav" in names
    assert f"{base}/Stems/Drums/Song 1-Kick.wav" in names  # stems in folders by group
    sheet = zipfile.ZipFile(path).read(f"{base}/About this song.txt").decode()
    assert "BPM: 124" in sheet and "Key: A minor" in sheet and "Kick" in sheet
    assert [p.name for p in out.iterdir()] == [path.name]  # no temp file left
    assert {p: (p.stat().st_mtime, p.read_bytes()) for p in src.rglob("*.wav")} == before
    # a second pack never overwrites the first
    assert Path(stempacks.make_pack(project, s, str(out))) != path


def test_api_lists_sets_and_packs(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")
    c = TestClient(app)
    cat = app.state.catalog
    for p, kind in ((_wav(tmp_path / "Stems" / "Song 1-Kick.wav", 1, when=T), "stem"),
                    (_wav(tmp_path / "Song.wav", 1, when=T), "song")):
        cat.link_export(str(p), "pid1", p.name, p.stat().st_size, p.stat().st_mtime, kind=kind)
    sets = c.get("/api/stems/pid1").json()["sets"]
    assert len(sets) == 1 and sets[0]["master"]["name"] == "Song.wav"
    out = tmp_path / "out"
    out.mkdir()
    assert c.post("/api/stems/pack", json={"project_id": "pid1", "set_id": "nope",
                                           "target": str(out)}).status_code == 404
    with c:
        r = c.post("/api/stems/pack", json={"project_id": "pid1", "set_id": sets[0]["id"],
                                            "target": str(out)})
        assert r.status_code == 200
        job = r.json()["job_id"]
        for _ in range(100):
            st = c.get(f"/api/jobs/{job}").json()
            if st["state"] != "running":
                break
            import time; time.sleep(0.05)
    assert st["state"] == "done" and Path(st["result"]["path"]).is_file()


def test_parts_are_sorted_into_groups_and_moves_are_kept(tmp_path):
    assert stempacks.auto_group("Kick") == "drums"
    assert stempacks.auto_group("Lead Vocals") == "vocals"
    assert stempacks.auto_group("Synth Bass") == "bass"
    assert stempacks.auto_group("Vocal FX") == "vocals"
    assert stempacks.auto_group("Pads") == "music"
    assert stempacks.auto_group("Riser") == "fx"
    assert stempacks.auto_group("Audio 7") == "other"
    app = create_app(token="", db_path=tmp_path / "c.db")
    c = TestClient(app)
    cat = app.state.catalog
    paths = []
    for n in ("Song 1-Pads.wav", "Song 2-Kick.wav", "Song 3-Weird Thing.wav"):
        p = _wav(tmp_path / "Stems" / n, 1, when=T)
        paths.append(str(p))
        cat.link_export(str(p), "pid1", p.name, p.stat().st_size, p.stat().st_mtime, kind="stem")
    parts = c.get("/api/stems/pid1").json()["sets"][0]["parts"]
    assert [p["group"] for p in parts] == ["drums", "music", "other"]  # desk order
    assert c.put("/api/stems/group", json={"paths": [paths[2]], "group": "fx"}).status_code == 200
    assert c.put("/api/stems/group", json={"paths": [paths[2]], "group": "nope"}).status_code == 400
    parts = c.get("/api/stems/pid1").json()["sets"][0]["parts"]
    weird = next(p for p in parts if p["path"] == paths[2])
    assert weird["group"] == "fx" and weird["auto_group"] == "other"
    c.put("/api/stems/group", json={"paths": [paths[2]], "group": None})
    parts = c.get("/api/stems/pid1").json()["sets"][0]["parts"]
    assert next(p for p in parts if p["path"] == paths[2])["group"] == "other"


def test_desk_order_and_export_order():
    assert stempacks.GROUP_IDS[:3] == ["drums", "bass", "vocals"]
    names = ["Song 10-Snare.wav", "Song 2-Kick.wav", "Song 1-Kick.wav"]
    assert sorted(names, key=stempacks._natural) == ["Song 1-Kick.wav", "Song 2-Kick.wav", "Song 10-Snare.wav"]
