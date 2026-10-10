"""Albums: one list shared with Uploader. Backups offers each project's exports (a WAV
and an MP3 of the same song count once), shows each song's project and backup state,
and can play every song on an album. The audio files are never changed."""
import hashlib
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup.albums import Albums
from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog


def _touch(p: Path, data: bytes = b"RIFF0000WAVE") -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def _project(cat: Catalog, pid: str, name: str, d: Path):
    d.mkdir(parents=True, exist_ok=True)
    cat.upsert_discovered([{"project_id": pid, "name": name, "path": str(d / f"{name}.als"),
                            "dir": str(d), "daw": "ableton", "owner": "me", "size": 1,
                            "mtime": 1.0, "missing_count": 0}], "2026-10-01_1200")


def _digest(folder: Path):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob("*")) if p.is_file()}


def test_album_from_backups_exports(tmp_path):
    d = tmp_path / "Night Drive Project"
    wav = _touch(d / "Night Drive.wav")
    mp3 = _touch(d / "Night Drive.mp3", b"ID3")
    other = _touch(tmp_path / "Exit 9 Project" / "Exit 9.wav")
    app = create_app(token="secret", db_path=tmp_path / "c.db")
    cat = app.state.catalog
    _project(cat, "p1", "Night Drive", d)
    _project(cat, "p2", "Exit 9", other.parent)
    for path, pid in ((wav, "p1"), (mp3, "p1"), (other, "p2")):
        cat.link_export(str(path), pid, path.stem, 1, 2.0)
    before = _digest(tmp_path / "Night Drive Project")
    c = TestClient(app)
    c.headers["X-Auth-Token"] = "secret"

    cands = c.get("/api/albums/candidates").json()
    assert sorted((x["project"], Path(x["path"]).name) for x in cands) == [
        ("Exit 9", "Exit 9.wav"), ("Night Drive", "Night Drive.wav")]

    a = c.post("/api/albums", json={"title": "Night Drive", "release_date": "2026-11-14"}).json()
    a = c.post(f"/api/albums/{a['id']}/songs", json={"songs": [
        {"path": str(other), "title": "Exit 9"}, {"path": str(mp3), "title": "Night Drive"}]}).json()
    first, second = a["songs"]
    assert first["project"] == "Exit 9" and first["project_id"] == "p2"
    assert second["needs"] == [] and second["is_ready"] is True   # the WAV beside it counts

    # songs on an album play, even one Backups hasn't linked to a project
    loose = _touch(tmp_path / "Elsewhere" / "Loose idea.wav")
    c.post(f"/api/albums/{a['id']}/songs", json={"songs": [{"path": str(loose)}]})
    assert c.get("/api/exports/audio", params={"path": str(loose), "t": "secret"}).status_code == 200
    stranger = _touch(tmp_path / "Elsewhere" / "Not on an album.wav")
    assert c.get("/api/exports/audio", params={"path": str(stranger), "t": "secret"}).status_code == 404

    # Uploader sees the same album
    assert [s["title"] for s in Albums().all()[0]["songs"]] == ["Exit 9", "Night Drive", "Loose idea"]
    assert _digest(tmp_path / "Night Drive Project") == before


def test_candidates_leave_out_samples_and_parts(tmp_path):
    """Robert, 10 Oct: the album picker offered FL "consolidated" clips, a lone Serum
    render and Splice samples. Only songs are offered; an "(OLD)" mix is still a song."""
    d = tmp_path / "140 Conni"
    keep = [_touch(d / "140 Conni.wav"), _touch(d / "140 Conni (OLD).wav")]
    drop = [_touch(d / "SOFT (consolidated).wav"), _touch(d / "SOFT #2 (consolidated).wav"),
            _touch(d / "Serum_x64 #2.wav"), _touch(d / "Pattern 3.wav"),
            _touch(tmp_path / "Splice" / "sounds" / "packs" / "Dark Keys 140.wav")]
    app = create_app(token="", db_path=tmp_path / "c.db")
    cat = app.state.catalog
    _project(cat, "p1", "140 Conni", d)
    for path in keep + drop:
        cat.link_export(str(path), "p1", path.stem, 1, 2.0)
    cands = TestClient(app).get("/api/albums/candidates").json()
    assert sorted(x["title"] for x in cands) == ["140 Conni", "140 Conni (OLD)"]
    assert {"bpm", "duration", "exported", "saved", "project_id"} <= set(cands[0])


def test_backup_state_per_song(tmp_path):
    d = tmp_path / "Song"
    wav = _touch(d / "Song.wav")
    app = create_app(token="", db_path=tmp_path / "c.db")
    cat = app.state.catalog
    _project(cat, "p1", "Song", d)
    cat.link_export(str(wav), "p1", "Song", 1, 2.0)
    c = TestClient(app)
    a = c.post("/api/albums", json={"title": "EP"}).json()
    a = c.post(f"/api/albums/{a['id']}/songs", json={"songs": [{"path": str(wav)}]}).json()
    assert a["songs"][0]["backup"] == "none"


def test_song_genre_colours_the_album(tmp_path):
    """A song's genre is its project's in Backups; a loose song keeps the one it was added with."""
    d = tmp_path / "Song"
    wav = _touch(d / "Song.wav")
    loose = _touch(tmp_path / "Elsewhere" / "Loose.wav")
    app = create_app(token="", db_path=tmp_path / "c.db")
    cat = app.state.catalog
    _project(cat, "p1", "Song", d)
    cat.conn.execute("UPDATE discovered SET genre = 'Techno' WHERE project_id = 'p1'")
    cat.conn.commit()
    cat.link_export(str(wav), "p1", "Song", 1, 2.0)
    c = TestClient(app)
    a = c.post("/api/albums", json={"title": "EP"}).json()
    a = c.post(f"/api/albums/{a['id']}/songs", json={"songs": [
        {"path": str(wav), "genre": "House"}, {"path": str(loose), "genre": "Dub"}, ]}).json()
    assert [s["genre"] for s in a["songs"]] == ["Techno", "Dub"]


def test_old_album_list_gains_genre(tmp_path):
    """A list made before songs kept a genre still opens, and its songs have none."""
    import sqlite3
    db = tmp_path / "albums.db"
    con = sqlite3.connect(db)
    con.executescript("""
      CREATE TABLE albums (id TEXT PRIMARY KEY, title TEXT NOT NULL, release_date TEXT NOT NULL DEFAULT '',
        crossfade REAL NOT NULL DEFAULT 0, created_at REAL NOT NULL, updated_at REAL NOT NULL);
      CREATE TABLE album_songs (album_id TEXT NOT NULL, pos INTEGER NOT NULL, path TEXT NOT NULL,
        title TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', gapless_after INTEGER NOT NULL DEFAULT 0,
        ready INTEGER, added_at REAL NOT NULL, PRIMARY KEY (album_id, path));
      INSERT INTO albums VALUES ('a1', 'Old', '', 0, 1, 1);
      INSERT INTO album_songs VALUES ('a1', 0, '/x/Old song.wav', 'Old song', '', 0, NULL, 1);
    """)
    con.commit()
    con.close()
    store = Albums(db)
    assert store.all()[0]["songs"][0]["genre"] == ""
    store.add_songs("a1", [{"path": "/x/New.wav", "genre": "Grime"}])
    assert [s["genre"] for s in store.all()[0]["songs"]] == ["", "Grime"]
