"""Song exports linked to projects, the Uploader bridge, and the player endpoint."""
import json
import os
import sqlite3
from pathlib import Path

import time

from fastapi.testclient import TestClient

from ablebackup import exports
from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog


def _touch(p: Path, data: bytes = b"RIFF0000WAVE") -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def _project(cat: Catalog, pid: str, name: str, d: Path, daw="ableton"):
    d.mkdir(parents=True, exist_ok=True)
    cat.upsert_discovered([{"project_id": pid, "name": name, "path": str(d / f"{name}.als"),
                            "dir": str(d), "daw": daw, "owner": "me", "size": 1,
                            "mtime": 1.0, "missing_count": 0}], "2026-10-01_1200")


def _uploader_db(path: Path, sources: list[str], uploads: list[dict]) -> Path:
    con = sqlite3.connect(path)
    con.executescript(
        "CREATE TABLE uploads (id INTEGER PRIMARY KEY, title TEXT, file_path TEXT, "
        "file_hash TEXT, size INTEGER, sharing TEXT, status TEXT, sc_track_id INTEGER, "
        "permalink_url TEXT, account TEXT, error TEXT, timestamp TEXT, "
        "backups_project TEXT, backups_project_id TEXT);"
        "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);")
    con.execute("INSERT INTO settings VALUES ('config', ?)", (json.dumps({"sources": sources}),))
    for u in uploads:
        con.execute("INSERT INTO uploads (title, file_path, status, permalink_url, timestamp, "
                    "backups_project_id) VALUES (?, ?, ?, ?, ?, ?)",
                    (u["title"], u["file_path"], u.get("status", "uploaded"), u["url"],
                     u.get("timestamp", "2026-10-01_1300"), u.get("project_id")))
    con.commit()
    con.close()
    return path


def test_normalize_matches_uploader_rules():
    assert exports.normalize("Night Drive final v2.wav") == "night drive"
    assert exports.normalize("Night_Drive (128 BPM) master.mp3") == "night drive"
    assert exports.normalize("Night Drive") == "night drive"


def test_folder_exports_skip_sample_folders(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    d = tmp_path / "Night Drive Project"
    _project(cat, "p1", "Night Drive", d)
    _touch(d / "Night Drive.wav")
    _touch(d / "Exports" / "anything at all.mp3")
    _touch(d / "Samples" / "Recorded" / "vocal take 3.wav")   # ingredient, not a song
    _touch(d / "notes.txt")
    exports.refresh(cat)
    names = sorted(e["name"] for e in cat.exports_for("p1"))
    assert names == ["Night Drive", "anything at all"]
    assert all(e["match"] == "folder" for e in cat.exports_for("p1"))


def test_shared_folder_matches_by_name_only(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    d = tmp_path / "FL Projects"
    _project(cat, "a", "Sunset", d, daw="flstudio")
    _project(cat, "b", "Moonrise", d, daw="flstudio")
    _touch(d / "Sunset master.wav")
    _touch(d / "random idea.wav")
    exports.refresh(cat)
    assert [e["name"] for e in cat.exports_for("a")] == ["Sunset master"]
    assert cat.exports_for("b") == []


def test_uploader_folder_name_match_and_ambiguity(tmp_path, monkeypatch):
    cat = Catalog(tmp_path / "c.db")
    _project(cat, "p1", "Night Drive", tmp_path / "proj1")
    _project(cat, "p2", "Twin", tmp_path / "proj2")
    _project(cat, "p3", "Twin", tmp_path / "proj3")       # same name -> ambiguous
    mixes = tmp_path / "Mixes"
    _touch(mixes / "Night Drive final v2.wav")
    _touch(mixes / "Twin master.wav")
    _touch(mixes / "Unrelated.wav")
    monkeypatch.setenv("ABLEBACKUP_UPLOADER_DB",
                       str(_uploader_db(tmp_path / "up.db", [str(mixes)], [])))
    exports.refresh(cat)
    assert [e["name"] for e in cat.exports_for("p1")] == ["Night Drive final v2"]
    assert cat.exports_for("p2") == [] and cat.exports_for("p3") == []


def test_manual_link_and_dismiss_survive_refresh(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    d = tmp_path / "proj"
    _project(cat, "p1", "Song", d)
    auto = _touch(d / "Song.wav")
    elsewhere = _touch(tmp_path / "Desktop" / "weird name.wav")
    exports.refresh(cat)
    cat.hide_export(str(auto.resolve()), "p1")
    cat.link_export(str(elsewhere.resolve()), "p1", "weird name", 1, 2.0)
    exports.refresh(cat)
    assert [e["name"] for e in cat.exports_for("p1")] == ["weird name"]


def test_api_lists_exports_with_uploads_and_plays(tmp_path, monkeypatch):
    d = tmp_path / "proj"
    wav = _touch(d / "Song.wav", b"RIFF" + b"\0" * 100)
    up = _uploader_db(tmp_path / "up.db", [], [
        {"title": "Song", "file_path": str(wav), "url": "https://soundcloud.com/me/song"},
        {"title": "Song (old)", "file_path": str(tmp_path / "gone.wav"),
         "url": "https://soundcloud.com/me/song-old", "project_id": "p1"},
        {"title": "Failed", "file_path": str(wav), "url": None, "status": "error"},
    ])
    monkeypatch.setenv("ABLEBACKUP_UPLOADER_DB", str(up))
    app = create_app(token="secret", db_path=tmp_path / "c.db")
    _project(app.state.catalog, "p1", "Song", d)
    c = TestClient(app)
    h = {"X-Auth-Token": "secret"}
    assert c.post("/api/exports/refresh", headers=h).json()["linked"] == 1

    body = c.get("/api/exports", params={"project_id": "p1"}, headers=h).json()
    assert body["uploader_installed"] is True
    [e] = body["exports"]
    assert e["exists"] and e["upload"]["url"] == "https://soundcloud.com/me/song"
    assert [u["title"] for u in body["uploads_elsewhere"]] == ["Song (old)"]

    lib = c.get("/api/library", headers=h).json()["projects"][0]
    assert lib["export_count"] == 1 and lib["latest_export"]["uploaded"] is True

    path = e["path"]
    assert c.get("/api/exports/audio", params={"path": path}).status_code == 401
    r = c.get("/api/exports/audio", params={"path": path, "t": "secret"})
    assert r.status_code == 200 and r.content.startswith(b"RIFF")
    assert r.headers["content-type"].startswith("audio/")
    # anything not in the exports list is refused, even a real file
    other = _touch(tmp_path / "private.wav")
    assert c.get("/api/exports/audio",
                 params={"path": str(other), "t": "secret"}).status_code == 404


def test_api_link_validates(tmp_path):
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    _project(c.app.state.catalog, "p1", "Song", tmp_path / "proj")
    txt = _touch(tmp_path / "notes.txt")
    wav = _touch(tmp_path / "x.wav")
    assert c.post("/api/exports/link", json={"path": str(txt), "project_id": "p1"}).status_code == 400
    assert c.post("/api/exports/link", json={"path": str(wav), "project_id": "nope"}).status_code == 404
    assert c.post("/api/exports/link", json={"path": str(wav), "project_id": "p1"}).status_code == 200
    rows = c.get("/api/exports", params={"project_id": "p1"}).json()["exports"]
    assert rows[0]["match"] == "manual"
    assert c.post("/api/exports/unlink",
                  json={"path": rows[0]["path"], "project_id": "p1"}).status_code == 200
    assert c.get("/api/exports", params={"project_id": "p1"}).json()["exports"] == []


def test_no_uploader_installed_is_quiet(tmp_path):
    assert exports.uploader_uploads() == []
    assert exports.uploader_sources() == []


def test_shared_exports_folder_is_the_main_case(tmp_path):
    """Robert's setup: every render goes into one WAVS/EXPORTS folder."""
    cat = Catalog(tmp_path / "c.db")
    _project(cat, "nd", "Night Drive", tmp_path / "Night Drive Project")
    _project(cat, "ndr", "Night Drive Remix", tmp_path / "Night Drive Remix Project")
    _project(cat, "sun", "Sunset", tmp_path / "Sunset Project")
    shared = tmp_path / "WAVS" / "EXPORTS"
    _touch(shared / "Night Drive final v2.wav")
    _touch(shared / "Night Drive - club edit.wav")          # starts with the name
    _touch(shared / "Night Drive Remix master.wav")         # longest name wins
    _touch(shared / "Sunset (128 BPM).mp3")
    _touch(shared / "Sunsets are nice.wav")                 # not a word boundary
    _touch(shared / "stems" / "Sunset kick.wav")            # subfolders are searched
    cat.set_setting("export_folders", [str(shared)])
    exports.refresh(cat)
    names = lambda pid: sorted(e["name"] for e in cat.exports_for(pid))
    assert names("nd") == ["Night Drive - club edit", "Night Drive final v2"]
    assert names("ndr") == ["Night Drive Remix master"]
    assert names("sun") == ["Sunset (128 BPM)", "Sunset kick"]


def test_same_name_projects_told_apart_by_save_time(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    for pid, mtime in (("old", 1_000_000.0), ("new", 50_000_000.0)):
        d = tmp_path / pid
        d.mkdir()
        cat.upsert_discovered([{"project_id": pid, "name": "Idea", "path": str(d / "Idea.als"),
                                "dir": str(d), "daw": "ableton", "owner": "me", "size": 1,
                                "mtime": mtime, "missing_count": 0}], "t")
    shared = tmp_path / "Exports"
    f = _touch(shared / "Idea.wav")
    os.utime(f, (50_000_600.0, 50_000_600.0))               # ten minutes after "new" was saved
    g = _touch(shared / "Idea 2.wav")
    os.utime(g, (25_000_000.0, 25_000_000.0))               # nowhere near either: don't guess
    cat.set_setting("export_folders", [str(shared)])
    exports.refresh(cat)
    assert [e["name"] for e in cat.exports_for("new")] == ["Idea"]
    assert cat.exports_for("old") == []


def test_api_export_folders(tmp_path):
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    _project(c.app.state.catalog, "p1", "Song", tmp_path / "proj")
    shared = tmp_path / "Exports"
    _touch(shared / "Song master.wav")
    r = c.put("/api/exports/folders", json={"folders": [str(shared), str(shared), " "]}).json()
    assert r == {"folders": [str(shared)], "linked": 1, "running": False}
    assert c.get("/api/exports/folders").json()["folders"] == [str(shared)]


def test_numbered_projects_keep_their_own_songs(tmp_path):
    """"Freaky", "Freaky 2", "Freaky 3": the number is part of the title, not a version."""
    cat = Catalog(tmp_path / "c.db")
    for pid, name in (("f1", "Freaky"), ("f2", "Freaky 2"), ("f3", "Freaky 3")):
        _project(cat, pid, name, tmp_path / "Projects" / f"{name} Project")
    shared = tmp_path / "Exports"
    _touch(shared / "Freaky 3 master.aif")
    _touch(shared / "Freaky 2 v4.mp3")
    _touch(shared / "Freaky final.wav")
    cat.set_setting("export_folders", [str(shared)])
    exports.refresh(cat)
    names = lambda pid: [e["name"] for e in cat.exports_for(pid)]
    assert names("f3") == ["Freaky 3 master"]
    assert names("f2") == ["Freaky 2 v4"]
    assert names("f1") == ["Freaky final"]


def test_song_named_after_the_project_folder(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    _project(cat, "p1", "freaky v7 FINAL ARRANGEMENT", tmp_path / "Late Night Project")
    shared = tmp_path / "Exports"
    _touch(shared / "Late Night.wav")
    cat.set_setting("export_folders", [str(shared)])
    exports.refresh(cat)
    assert [e["name"] for e in cat.exports_for("p1")] == ["Late Night"]


def test_exports_folder_found_without_being_told(tmp_path, monkeypatch):
    """Robert's case: one "NEW EXPORTS AIFS:MP3S" folder beside his projects, never
    added in Backups. It is found and its songs linked; ignoring it stops that."""
    monkeypatch.setenv("ABLEBACKUP_FIND_EXPORT_FOLDERS", "1")
    cat = Catalog(tmp_path / "c.db")
    music = tmp_path / "home" / "Music"
    _project(cat, "p1", "Sunset", music / "Ableton" / "Sunset Project")
    cat.set_setting("config", {"sources": [str(music / "Ableton")]})
    shared = music / "NEW EXPORTS AIFS:MP3S"
    _touch(shared / "Sunset master.aif")
    _touch(music / "Exports but empty" / "readme.txt")      # no audio: not an exports folder
    exports.refresh(cat)
    assert exports.found_folders(cat) == [shared.resolve()]
    assert [e["name"] for e in cat.exports_for("p1")] == ["Sunset master"]

    cat.set_setting("ignored_export_folders", [str(shared)])
    exports.refresh(cat)
    assert exports.found_folders(cat) == []
    assert cat.exports_for("p1") == []

    cat.set_setting("ignored_export_folders", [])
    cat.set_setting("find_export_folders", False)
    exports.refresh(cat)
    assert cat.exports_for("p1") == []


def test_exports_relinked_when_the_app_starts(tmp_path):
    """A library scanned before songs were linked gets them on the next start."""
    db = tmp_path / "c.db"
    cat = Catalog(db)
    _project(cat, "p1", "Sunset", tmp_path / "Sunset Project")
    _touch(tmp_path / "Sunset Project" / "Sunset.wav")
    cat.close()
    with TestClient(create_app(token="", db_path=db)) as c:
        for _ in range(100):  # the start-up refresh runs in the background
            if c.app.state.catalog.exports_for("p1"):
                break
            time.sleep(0.05)
        assert [e["name"] for e in c.app.state.catalog.exports_for("p1")] == ["Sunset"]
        r = c.get("/api/exports/folders").json()
        assert set(r) == {"folders", "found_folders", "ignored", "uploader_folders"}


def test_a_folder_that_never_answers_is_skipped_not_waited_on(tmp_path, monkeypatch):
    """A sleeping network share can make a folder check hang for minutes; the re-check
    gives up on that drive after a few seconds and keeps its earlier links."""
    cat = Catalog(tmp_path / "c.db")
    _project(cat, "p1", "Sunset", tmp_path / "Sunset Project")
    _touch(tmp_path / "Sunset Project" / "Sunset.wav")
    _project(cat, "nas", "Night Drive", tmp_path / "nas" / "Night Drive Project")
    cat.replace_auto_exports([{"path": "/Volumes/NAS/Night Drive.wav", "project_id": "nas",
                               "name": "Night Drive", "size": 1, "mtime": 1.0, "match": "name"}])
    real_isdir = os.path.isdir
    def slow_isdir(p):
        if "nas" in str(p):
            time.sleep(30)
        return real_isdir(p)
    monkeypatch.setattr(exports.os.path, "isdir", slow_isdir)
    monkeypatch.setattr(exports._Reach.__init__, "__defaults__", (0.2,))
    t0 = time.monotonic()
    exports.refresh(cat)
    assert time.monotonic() - t0 < 5
    assert [e["name"] for e in cat.exports_for("p1")] == ["Sunset"]
    assert [e["name"] for e in cat.exports_for("nas")] == ["Night Drive"]  # kept, not wiped
    assert exports.progress()["running"] is False


def test_recheck_stops_at_its_time_limit(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    _project(cat, "p1", "Sunset", tmp_path / "Sunset Project")
    _touch(tmp_path / "Sunset Project" / "Sunset.wav")
    exports.refresh(cat, limit=-1)          # already out of time: finds nothing, breaks nothing
    assert exports.progress()["timed_out"] is True
    exports.refresh(cat)
    assert [e["name"] for e in cat.exports_for("p1")] == ["Sunset"]


def test_api_recheck_status(tmp_path):
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    _project(c.app.state.catalog, "p1", "Song", tmp_path / "proj")
    _touch(tmp_path / "proj" / "Song.wav")
    assert c.post("/api/exports/refresh").json() == {"linked": 1, "running": False}
    st = c.get("/api/exports/status").json()
    assert st["running"] is False and st["linked"] == 1 and st["folders_done"] == st["folders_total"]


def test_a_stuck_disk_cannot_hang_the_recheck(tmp_path, monkeypatch):
    """If listing a folder blocks (macOS waiting on a permission prompt nobody
    answers), the re-check still returns, and the next one isn't locked out."""
    cat = Catalog(tmp_path / "c.db")
    _project(cat, "p1", "Sunset", tmp_path / "Sunset Project")
    _touch(tmp_path / "Sunset Project" / "Sunset.wav")
    real = exports._audio_files
    stuck = {"on": True}
    def blocking(*a, **k):
        while stuck["on"]:
            time.sleep(0.05)
        return real(*a, **k)
    monkeypatch.setattr(exports, "_audio_files", blocking)
    t0 = time.monotonic()
    assert exports.refresh(cat, limit=0.3) == 0
    assert time.monotonic() - t0 < 8 and exports.progress()["timed_out"] is True
    monkeypatch.setattr(exports, "_audio_files", real)
    assert exports.refresh(cat) == 1          # not locked out by the stuck one
    stuck["on"] = False                        # the abandoned worker finishes late...
    time.sleep(0.3)
    assert [e["name"] for e in cat.exports_for("p1")] == ["Sunset"]  # ...and changes nothing
