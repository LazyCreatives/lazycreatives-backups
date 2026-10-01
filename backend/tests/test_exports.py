"""Song exports linked to projects, the Uploader bridge, and the player endpoint."""
import json
import os
import sqlite3
from pathlib import Path

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
    assert r == {"folders": [str(shared)], "linked": 1}
    assert c.get("/api/exports/folders").json()["folders"] == [str(shared)]
