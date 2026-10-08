"""Your phone: pairing with a one-time code, then a paired phone can list projects and
albums and fetch songs Backups knows. Nothing works until the switch is on, a removed
phone is cut off at once, and the songs on disk are never changed."""
import hashlib
from pathlib import Path

from fastapi.testclient import TestClient

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


def _setup(tmp_path, monkeypatch):
    monkeypatch.setenv("ABLEBACKUP_PHONE_SERVE", "0")   # no real network server in tests
    d = tmp_path / "Night Drive Project"
    wav = _touch(d / "Night Drive.wav")
    secret = _touch(tmp_path / "Private" / "notes.txt", b"not a song")
    app = create_app(token="secret", db_path=tmp_path / "c.db")
    cat = app.state.catalog
    _project(cat, "p1", "Night Drive", d)
    cat.link_export(str(wav), "p1", "Night Drive", 12, 2.0)
    desk = TestClient(app)
    desk.headers["X-Auth-Token"] = "secret"
    phone = TestClient(app.state.phone.app)
    return app, desk, phone, wav, secret


def _pair(desk, phone, name="Robert's iPhone"):
    code = desk.post("/api/phone/code").json()["code"]
    r = phone.post("/phone/pair", json={"code": code, "name": name})
    assert r.status_code == 200
    return r.json()


def test_off_until_switched_on(tmp_path, monkeypatch):
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    assert desk.get("/api/phone").json()["enabled"] is False
    assert desk.post("/api/phone/code").status_code == 409
    assert phone.post("/phone/pair", json={"code": "guess"}).status_code == 403


def test_pair_browse_and_fetch(tmp_path, monkeypatch):
    app, desk, phone, wav, secret = _setup(tmp_path, monkeypatch)
    before = hashlib.sha256(wav.read_bytes()).hexdigest()
    desk.put("/api/phone", json={"enabled": True})
    got = _pair(desk, phone)
    auth = {"Authorization": f"Bearer {got['key']}"}

    # the code works once
    assert phone.post("/phone/pair", json={"code": "x" * 22}).status_code == 403

    status = desk.get("/api/phone").json()
    assert [d["name"] for d in status["devices"]] == ["Robert's iPhone"]
    assert "key" not in status["devices"][0]
    # only a fingerprint of the key is stored
    assert got["key"] not in str(app.state.catalog.get_setting("phone"))

    assert phone.get("/phone/projects").status_code == 401
    projects = phone.get("/phone/projects", headers=auth).json()["projects"]
    assert [(p["name"], p["songs"]) for p in projects] == [("Night Drive", 1)]
    songs = phone.get("/phone/projects/p1", headers=auth).json()["songs"]
    assert songs[0]["title"] == "Night Drive" and songs[0]["format"] == "WAV"

    a = desk.post("/api/albums", json={"title": "After Hours"}).json()
    desk.post(f"/api/albums/{a['id']}/songs", json={"songs": [{"path": str(wav)}]})
    albums = phone.get("/phone/albums", headers=auth).json()["albums"]
    assert albums[0]["title"] == "After Hours" and albums[0]["songs"][0]["size"] == 12

    r = phone.get("/phone/song", params={"path": str(wav)}, headers=auth)
    assert r.status_code == 200 and r.content == wav.read_bytes()
    assert phone.get("/phone/song", params={"path": str(wav), "k": got["key"]}).status_code == 200
    # nothing else on the computer can be read
    assert phone.get("/phone/song", params={"path": str(secret)}, headers=auth).status_code == 404
    assert hashlib.sha256(wav.read_bytes()).hexdigest() == before


def test_remove_and_switch_off_cut_the_phone_off(tmp_path, monkeypatch):
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    desk.put("/api/phone", json={"enabled": True})
    got = _pair(desk, phone)
    auth = {"Authorization": f"Bearer {got['key']}"}
    assert phone.get("/phone/hello", headers=auth).status_code == 200

    desk.put("/api/phone", json={"enabled": False})
    assert phone.get("/phone/hello", headers=auth).status_code == 401
    desk.put("/api/phone", json={"enabled": True})
    assert phone.get("/phone/hello", headers=auth).status_code == 200

    assert desk.delete(f"/api/phone/devices/{got['device_id']}").status_code == 200
    assert phone.get("/phone/hello", headers=auth).status_code == 401
    assert desk.delete(f"/api/phone/devices/{got['device_id']}").status_code == 404
