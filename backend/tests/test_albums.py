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
