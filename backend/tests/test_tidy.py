"""Tidy names: renaming a song's versions, folder and exports together, and Undo."""
import json
import os
import sqlite3
import time
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup import exports, tidy
from ablebackup.api.app import create_app
from ablebackup.scanner import scan_one
from tests.helpers import fileref_rel, write_als
from tests.test_flstudio import _make_flp
from tests.test_logic import make_logicx
from tests.test_studioone import make_song


import pytest


@pytest.fixture(autouse=True)
def _every_program(monkeypatch):
    monkeypatch.setenv("ABLEBACKUP_FREE_BETA", "1")  # all music programs, as shipped


def _client(tmp_path):
    return TestClient(create_app(token="", db_path=tmp_path / "c.db"))


def _age(p: Path, minutes_ago: int):
    t = time.time() - minutes_ago * 60
    os.utime(p, (t, t))


def _glasshouse(root: Path) -> Path:
    """Robert's example: two versions in one Ableton folder, with exports."""
    proj = root / "Glasshouse Project"
    (proj / "Samples" / "Recorded").mkdir(parents=True)
    (proj / "Samples" / "Recorded" / "vox.wav").write_bytes(b"vox")
    (proj / "Backup").mkdir()
    (proj / "Backup" / "Glasshouse v2 [2026-10-01 120000].als").write_bytes(b"old")
    write_als(proj / "Glasshouse v2.als", [fileref_rel("Samples/Recorded/vox.wav", "vox.wav")])
    write_als(proj / "Glasshouse FINAL 3.als", [fileref_rel("Samples/Recorded/vox.wav", "vox.wav")])
    _age(proj / "Glasshouse v2.als", 120)
    _age(proj / "Glasshouse FINAL 3.als", 60)
    (proj / "glasshouse final 3 master.wav").write_bytes(b"RIFFmaster")
    _age(proj / "glasshouse final 3 master.wav", 50)
    return proj


def _scan(c, src):
    r = c.post("/api/scan", json={"sources": [str(src)]})
    assert r.status_code == 200
    return {p["name"]: p for p in c.get("/api/library").json()["projects"]}


def _rows(plan, kind=None):
    rows = [r for g in plan["groups"] for r in g["rows"]]
    return [r for r in rows if kind is None or r["kind"] == kind]


def test_suggested_name_drops_version_words():
    assert tidy.suggest_base("Glasshouse FINAL 3") == "Glasshouse"
    assert tidy.suggest_base("Night Drive v2 copy") == "Night Drive"
    assert tidy.suggest_base("Night_Drive_v7") == "Night Drive"
    assert tidy.suggest_base("Freaky (128 BPM) final") == "Freaky"
    assert tidy.suggest_base("v2") == "v2"  # never empty


def test_extra_words_keep_what_the_export_adds():
    assert tidy._extra_words("glasshouse final 3 master", "Glasshouse FINAL 3") == "master"
    assert tidy._extra_words("Glasshouse v2 - club edit", "Glasshouse v2") == "club edit"
    assert tidy._extra_words("Glasshouse v2", "Glasshouse v2") == ""


def test_preview_lists_folder_versions_and_songs_and_changes_nothing(tmp_path):
    src = tmp_path / "music"
    proj = _glasshouse(src)
    c = _client(tmp_path)
    lib = _scan(c, src)
    before = sorted(p.name for p in proj.rglob("*"))
    plan = c.post("/api/tidy/preview", json={"project_ids": [lib["Glasshouse v2"]["project_id"]]}).json()
    assert len(plan["groups"]) == 1
    g = plan["groups"][0]
    assert g["name"] == "Glasshouse" and g["versions"] == 2 and g["songs"] == 1
    folder = _rows(plan, "folder")[0]
    assert folder["status"] == "same"  # "Glasshouse Project" is already right
    versions = {r["old_name"]: r["new_name"] for r in _rows(plan, "version")}
    # the numbers people already wrote are kept
    assert versions == {"Glasshouse v2.als": "Glasshouse v2.als",
                        "Glasshouse FINAL 3.als": "Glasshouse v3.als"}
    songs = {r["old_name"]: r["new_name"] for r in _rows(plan, "song")}
    assert songs == {"glasshouse final 3 master.wav": "Glasshouse v3 (master).wav"}
    assert sorted(p.name for p in proj.rglob("*")) == before


def test_rename_keeps_project_structure_and_undo_puts_it_all_back(tmp_path):
    src = tmp_path / "music"
    proj = _glasshouse(src)
    c = _client(tmp_path)
    lib = _scan(c, src)
    pid = lib["Glasshouse FINAL 3"]["project_id"]
    untouched = {p: p.read_bytes() for p in proj.rglob("*") if p.is_file()
                 and ("Samples" in p.parts or "Backup" in p.parts)}

    r = c.post("/api/tidy/apply", json={"project_ids": [pid], "names": {}, "folder": True,
                                        "overrides": {}, "skip": [], "numbers": "order"})
    assert r.status_code == 200, r.text
    done = r.json()
    assert done["renamed"] == 3
    names = sorted(p.name for p in proj.iterdir())
    assert names == ["Backup", "Glasshouse v1.als", "Glasshouse v2 (master).wav",
                     "Glasshouse v2.als", "Samples"]
    # samples, recordings and Ableton's own Backup folder are exactly as they were
    for p, data in untouched.items():
        assert p.read_bytes() == data
    # the renamed project still finds every sample
    assert not scan_one(proj / "Glasshouse v2.als").missing

    # Backups' records follow: new names, new ids, song still linked
    lib2 = {p["name"]: p for p in c.get("/api/library").json()["projects"]}
    assert set(lib2) == {"Glasshouse v1", "Glasshouse v2"}
    new_id = done["id_map"][pid]
    assert lib2["Glasshouse v2"]["project_id"] == new_id
    songs = c.get("/api/exports", params={"project_id": new_id}).json()["exports"]
    assert [Path(s["path"]).name for s in songs] == ["Glasshouse v2 (master).wav"]
    last = c.get("/api/tidy/last", params={"project_id": new_id}).json()["batch"]
    assert last and last["count"] == 3

    # one Undo puts every name back
    u = c.post("/api/tidy/undo", json={"batch_id": last["id"]})
    assert u.status_code == 200, u.text
    assert sorted(p.name for p in proj.iterdir()) == [
        "Backup", "Glasshouse FINAL 3.als", "Glasshouse v2.als",
        "Samples", "glasshouse final 3 master.wav"]
    lib3 = {p["name"]: p for p in c.get("/api/library").json()["projects"]}
    assert lib3["Glasshouse FINAL 3"]["project_id"] == pid
    songs = c.get("/api/exports", params={"project_id": pid}).json()["exports"]
    assert [Path(s["path"]).name for s in songs] == ["glasshouse final 3 master.wav"]
    assert c.get("/api/tidy/last", params={"project_id": pid}).json()["batch"] is None
    # and it can't be undone twice
    assert c.post("/api/tidy/undo", json={"batch_id": last["id"]}).status_code == 409


def test_folder_renamed_with_the_song_and_backups_follow(tmp_path):
    src = tmp_path / "music"
    proj = src / "glasshouse idea Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loop")
    write_als(proj / "glasshouse idea.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    dest = tmp_path / "NAS"
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        c.put("/api/settings", json={"sources": [str(src)], "dest": str(dest), "interval_minutes": 0})
        lib = _scan(c, src)
        pid = lib["glasshouse idea"]["project_id"]
        job = c.post("/api/backup", json={}).json()["job_id"]
        for _ in range(100):
            if c.get(f"/api/jobs/{job}").json()["state"] == "done":
                break
            time.sleep(0.05)
        backup_dirs = sorted(p.name for p in (dest / "AbletonBackups" / "projects").iterdir())

        plan = c.post("/api/tidy/preview", json={"project_ids": [pid], "names": {pid: "Glasshouse"}}).json()
        folder = _rows(plan, "folder")[0]
        assert folder["status"] == "rename" and folder["new_name"] == "Glasshouse Project"
        r = c.post("/api/tidy/apply", json={"project_ids": [pid], "names": {pid: "Glasshouse"}})
        assert r.status_code == 200, r.text
        new = src / "Glasshouse Project" / "Glasshouse.als"
        assert new.is_file() and not proj.exists()
        assert not scan_one(new).missing
        lib2 = {p["name"]: p for p in c.get("/api/library").json()["projects"]}
        item = lib2["Glasshouse"]
        assert item["backed_up"] and item["snapshot_count"] == 1
        assert item["dir"] == str(src / "Glasshouse Project")
        # the backup copy keeps the name it was made with, and shows under the new name
        assert sorted(p.name for p in (dest / "AbletonBackups" / "projects").iterdir()) == backup_dirs
        assert len(c.get("/api/projects/Glasshouse").json()["snapshots"]) == 1


def test_folder_with_other_songs_keeps_its_name(tmp_path):
    src = tmp_path / "music"
    shared = src / "Glasshouse"
    write_als(shared / "Glasshouse v1.als", [])
    write_als(shared / "Night Drive.als", [])
    c = _client(tmp_path)
    lib = _scan(c, src)
    plan = c.post("/api/tidy/preview", json={"project_ids": [lib["Glasshouse v1"]["project_id"]],
                                             "names": {lib["Glasshouse v1"]["project_id"]: "Glass House"}}).json()
    folder = _rows(plan, "folder")[0]
    assert folder["status"] == "kept" and "Other songs" in folder["note"]
    assert [r["old_name"] for r in _rows(plan, "version")] == ["Glasshouse v1.als"]


def test_fl_studio_folder_with_full_sample_addresses_keeps_its_name(tmp_path):
    src = tmp_path / "music"
    proj = src / "Glasshouse"
    (proj / "Audio").mkdir(parents=True)
    kick = proj / "Audio" / "kick.wav"
    kick.write_bytes(b"kick")
    (proj / "Glasshouse 2.flp").write_bytes(_make_flp([str(kick)]))
    c = _client(tmp_path)
    lib = _scan(c, src)
    pid = lib["Glasshouse 2"]["project_id"]
    plan = c.post("/api/tidy/preview", json={"project_ids": [pid], "names": {pid: "Glass House"}}).json()
    folder = _rows(plan, "folder")[0]
    assert folder["status"] == "kept" and "full" in folder["note"]
    r = c.post("/api/tidy/apply", json={"project_ids": [pid], "names": {pid: "Glass House"}})
    assert r.status_code == 200, r.text
    renamed = proj / "Glass House.flp"
    assert renamed.is_file()
    assert renamed.read_bytes() == _make_flp([str(kick)])  # the project file itself is never edited
    assert not scan_one(renamed).missing
    assert kick.read_bytes() == b"kick"  # a sample in the folder is never taken for a song


def test_a_sample_the_project_plays_is_never_renamed(tmp_path):
    src = tmp_path / "music"
    proj = src / "Glasshouse"
    write_als(proj / "Glasshouse v3.als", [fileref_rel("Bits/riser.wav", "riser.wav")])
    (proj / "Bits").mkdir()
    (proj / "Bits" / "riser.wav").write_bytes(b"riser")
    c = _client(tmp_path)
    lib = _scan(c, src)
    pid = lib["Glasshouse v3"]["project_id"]
    plan = c.post("/api/tidy/preview", json={"project_ids": [pid]}).json()
    rows = {r["old_name"]: r for r in _rows(plan, "song")}
    assert rows["riser.wav"]["status"] == "kept"


def test_logic_package_and_studio_one_song_rename(tmp_path):
    src = tmp_path / "music"
    pkg = make_logicx(src / "Night Drive", name="night drive v3")
    song = make_song(src / "Glasshouse 2", name="Glasshouse 2")
    c = _client(tmp_path)
    lib = _scan(c, src)
    lp, sp = lib["night drive v3"]["project_id"], lib["Glasshouse 2"]["project_id"]
    r = c.post("/api/tidy/apply", json={"project_ids": [lp, sp],
                                        "names": {lp: "Night Drive", sp: "Glasshouse"}})
    assert r.status_code == 200, r.text
    new_pkg = src / "Night Drive" / "Night Drive.logicx"
    assert new_pkg.is_dir() and not pkg.exists()
    assert (new_pkg / "Media" / "Audio Files" / "Vox#01.wav").is_file()  # inside untouched
    assert not scan_one(new_pkg).missing
    # Studio One finds recordings through the song folder's name: the folder stays
    new_song = src / "Glasshouse 2" / "Glasshouse.song"
    assert new_song.is_file() and (src / "Glasshouse 2" / "Media" / "Vox 01.wav").is_file()
    assert not scan_one(new_song).missing


def test_skip_and_override_and_clash(tmp_path):
    src = tmp_path / "music"
    proj = _glasshouse(src)
    (proj / "Glasshouse v1.als").write_bytes(b"not a real project, but in the way")
    c = _client(tmp_path)
    lib = _scan(c, src)
    pid = lib["Glasshouse v2"]["project_id"]
    plan = c.post("/api/tidy/preview", json={"project_ids": [pid], "numbers": "order"}).json()
    v = {r["old_name"]: r for r in _rows(plan, "version")}
    assert v["Glasshouse v2.als"]["status"] == "blocked"  # Glasshouse v1.als exists
    plan = c.post("/api/tidy/preview", json={
        "project_ids": [pid], "skip": [str(proj / "glasshouse final 3 master.wav")],
        "overrides": {str(proj / "Glasshouse v2.als"): "Glasshouse first idea"}}).json()
    v = {r["old_name"]: r for r in _rows(plan)}
    assert v["Glasshouse v2.als"]["new_name"] == "Glasshouse first idea.als"
    assert v["glasshouse final 3 master.wav"]["status"] == "skipped"


def test_failed_rename_puts_back_what_was_done(tmp_path, monkeypatch):
    src = tmp_path / "music"
    proj = _glasshouse(src)
    c = _client(tmp_path)
    lib = _scan(c, src)
    pid = lib["Glasshouse v2"]["project_id"]
    real = os.rename
    calls = []

    def flaky(a, b):
        calls.append(a)
        if len(calls) == 2:
            raise PermissionError(13, "Permission denied")
        return real(a, b)

    monkeypatch.setattr(tidy.os, "rename", flaky)
    before = sorted(p.name for p in proj.iterdir())
    r = c.post("/api/tidy/apply", json={"project_ids": [pid], "numbers": "order"})
    assert r.status_code == 409 and "Nothing was renamed" in r.json()["detail"]
    monkeypatch.setattr(tidy.os, "rename", real)
    assert sorted(p.name for p in proj.iterdir()) == before
    assert {p["name"] for p in c.get("/api/library").json()["projects"]} == {
        "Glasshouse v2", "Glasshouse FINAL 3"}


def test_uploaded_song_stays_linked_to_soundcloud(tmp_path, monkeypatch):
    src = tmp_path / "music"
    proj = _glasshouse(src)
    master = proj / "glasshouse final 3 master.wav"
    db = tmp_path / "uploader.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE uploads (id INTEGER PRIMARY KEY, title TEXT, file_path TEXT, "
        "status TEXT, permalink_url TEXT, timestamp TEXT, backups_project_id TEXT);"
        "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);")
    con.execute("INSERT INTO settings VALUES ('config', ?)", (json.dumps({"sources": []}),))
    con.execute("INSERT INTO uploads (title, file_path, status, permalink_url, timestamp) "
                "VALUES ('Glasshouse', ?, 'uploaded', 'https://soundcloud.com/x/glasshouse', '2026-10-01')",
                (str(master),))
    con.commit()
    con.close()
    monkeypatch.setenv("ABLEBACKUP_UPLOADER_DB", str(db))
    c = _client(tmp_path)
    lib = _scan(c, src)
    pid = lib["Glasshouse FINAL 3"]["project_id"]
    plan = c.post("/api/tidy/preview", json={"project_ids": [pid]}).json()
    assert _rows(plan, "song")[0]["uploaded"] is True
    done = c.post("/api/tidy/apply", json={"project_ids": [pid], "numbers": "order"}).json()
    songs = c.get("/api/exports", params={"project_id": done["id_map"][pid]}).json()["exports"]
    assert songs[0]["upload"]["url"] == "https://soundcloud.com/x/glasshouse"
    lib2 = {p["name"]: p for p in c.get("/api/library").json()["projects"]}
    assert lib2["Glasshouse v2"]["latest_export"]["uploaded"] is True
    # Uploader can follow the rename from Backups' records
    con = sqlite3.connect(tmp_path / "c.db")
    rows = con.execute("SELECT old, new, kind FROM renamed").fetchall()
    con.close()
    follow = tidy.follow_with([{"old": o, "new": n, "kind": k} for o, n, k in rows])
    assert follow(exports._resolve(master)) == exports._resolve(proj / "Glasshouse v2 (master).wav")


def test_versions_sort_naturally_with_ten_or_more(tmp_path):
    src = tmp_path / "music"
    d = src / "Loop"
    for i in range(1, 12):
        write_als(d / f"loop {i}.als", [])
        _age(d / f"loop {i}.als", 100 - i)
    c = _client(tmp_path)
    lib = _scan(c, src)
    pid = lib["loop 1"]["project_id"]
    plan = c.post("/api/tidy/preview", json={"project_ids": [pid], "style": "v0",
                                             "names": {}}).json()
    new = [r["new_name"] for r in _rows(plan, "version")]
    gid = plan["groups"][0]["id"]
    assert plan["groups"][0]["name"] == "loop"
    assert new[0] == "loop v01.als" and new[-1] == "loop v11.als"
    assert new == sorted(new)
    assert gid


def test_undo_refuses_when_files_moved_since_and_never_overwrites(tmp_path):
    src = tmp_path / "music"
    proj = _glasshouse(src)
    c = _client(tmp_path)
    lib = _scan(c, src)
    pid = lib["Glasshouse v2"]["project_id"]
    done = c.post("/api/tidy/apply", json={"project_ids": [pid], "numbers": "order"}).json()
    (proj / "Glasshouse v1.als").rename(proj / "Glasshouse moved.als")
    r = c.post("/api/tidy/undo", json={"batch_id": done["batch_id"]})
    assert r.status_code == 409 and "Nothing was changed" in r.json()["detail"]
    (proj / "Glasshouse moved.als").rename(proj / "Glasshouse v1.als")
    # someone saved a new file under an old name: undo stops rather than replace it
    (proj / "Glasshouse FINAL 3.als").write_bytes(b"new work")
    r = c.post("/api/tidy/undo", json={"batch_id": done["batch_id"]})
    assert r.status_code == 409
    assert (proj / "Glasshouse FINAL 3.als").read_bytes() == b"new work"
    assert (proj / "Glasshouse v1.als").is_file() and (proj / "Glasshouse v2.als").is_file()


def test_numbers_kept_or_counted():
    m = [{"name": n} for n in ("Glasshouse", "Glasshouse v2", "Glasshouse FINAL 3", "Glasshouse copy 3")]
    assert tidy.numbering(m, keep=True) == [1, 2, 3, 4]
    assert tidy.numbering([{"name": "a v5"}, {"name": "a"}, {"name": "a v2"}], keep=True) == [5, 1, 2]
    assert tidy.numbering(m, keep=False) == [1, 2, 3, 4]


def test_suggestion_prefers_the_spelling_with_capitals():
    assert tidy._best_spelling(["freaky", "Freaky"]) == "Freaky"
    assert tidy._best_spelling(["night drive"]) == "night drive"
