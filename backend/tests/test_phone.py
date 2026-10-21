"""Your phone: pairing with a one-time code, then a paired phone can list projects and
albums and fetch songs Backups knows. Nothing works until the switch is on, a removed
phone is cut off at once, and the songs on disk are never changed. Everything after
pairing is signed and locked, so nobody else on the Wi-Fi can read, fake or replay it."""
import hashlib
import json
import secrets
import time
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog
from ablebackup.phone import b64url, keys_for, seal, sign, unb64url, unseal


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


class Phone:
    """What the phone app does: pair with the picture's secret, sign each request,
    unlock each answer."""

    def __init__(self, client: TestClient, got: dict):
        self.client, self.id = client, got["device_id"]
        self.secret = unb64url(got["key"])
        self.lock, self.signer = keys_for(self.secret)

    def headers(self, target: str, method: str = "GET", nonce: str | None = None,
                when: int | None = None) -> dict:
        nonce = nonce or secrets.token_hex(16)
        when = str(when if when is not None else int(time.time()))
        return {"X-LC-Phone": self.id, "X-LC-Time": when, "X-LC-Nonce": nonce,
                "X-LC-Sign": sign(self.signer, method, target, when, nonce)}

    def raw(self, path: str, params: dict | None = None, **kw):
        target = path + (f"?{urlencode(params)}" if params else "")
        h = self.headers(target, **kw)
        return self.client.get(target, headers=h), h["X-LC-Nonce"]

    def get(self, path: str, params: dict | None = None):
        r, nonce = self.raw(path, params)
        assert r.status_code == 200, r.text
        return json.loads(unseal(self.lock, r.content, f"answer:{nonce}".encode()))

    def song(self, path: str) -> bytes:
        r, nonce = self.raw("/phone/song", {"path": path})
        assert r.status_code == 200, r.text
        data, out, i = r.content, b"", 0
        while data:
            n = int.from_bytes(data[:4], "big")
            blob, data = data[4:4 + n], data[4 + n:]
            end = "end" if not data else "more"
            out += unseal(self.lock, blob, f"song:{nonce}:{i}:{end}".encode())
            i += 1
        return out


def _pair(desk, phone, name="Robert's iPhone"):
    link = desk.post("/api/phone/code").json()["link"]
    q = {k: v[0] for k, v in parse_qs(urlparse(link).query).items()}
    secret = unb64url(q["s"])
    locked = seal(secret, json.dumps({"name": name}).encode(), f"pair:{q['code']}".encode())
    r = phone.post("/phone/pair", json={"code": q["code"], "locked": b64url(locked)})
    assert r.status_code == 200
    got = json.loads(unseal(secret, unb64url(r.json()["locked"]), f"paired:{q['code']}".encode()))
    return Phone(phone, got)


def test_off_until_switched_on(tmp_path, monkeypatch):
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    assert desk.get("/api/phone").json()["enabled"] is False
    assert desk.post("/api/phone/code").status_code == 409
    assert phone.post("/phone/pair", json={"code": "guess", "locked": "x"}).status_code == 403


def test_pair_browse_and_fetch(tmp_path, monkeypatch):
    app, desk, phone, wav, secret = _setup(tmp_path, monkeypatch)
    before = hashlib.sha256(wav.read_bytes()).hexdigest()
    desk.put("/api/phone", json={"enabled": True})
    me = _pair(desk, phone)

    # the code works once
    assert phone.post("/phone/pair", json={"code": "x" * 22, "locked": "x"}).status_code == 403

    status = desk.get("/api/phone").json()
    assert [d["name"] for d in status["devices"]] == ["Robert's iPhone"]
    assert "secret" not in status["devices"][0]

    assert phone.get("/phone/projects").status_code == 401
    projects = me.get("/phone/projects")["projects"]
    assert [(p["name"], p["songs"]) for p in projects] == [("Night Drive", 1)]
    songs = me.get("/phone/projects/p1")["songs"]
    assert songs[0]["title"] == "Night Drive" and songs[0]["format"] == "WAV"

    a = desk.post("/api/albums", json={"title": "After Hours"}).json()
    desk.post(f"/api/albums/{a['id']}/songs", json={"songs": [{"path": str(wav)}]})
    albums = me.get("/phone/albums")["albums"]
    assert albums[0]["title"] == "After Hours" and albums[0]["songs"][0]["size"] == 12

    assert me.song(str(wav)) == wav.read_bytes()
    # nothing else on the computer can be read
    r, _ = me.raw("/phone/song", {"path": str(secret)})
    assert r.status_code == 404
    assert hashlib.sha256(wav.read_bytes()).hexdigest() == before


def test_nothing_readable_on_the_wifi(tmp_path, monkeypatch):
    app, desk, phone, wav, _ = _setup(tmp_path, monkeypatch)
    desk.put("/api/phone", json={"enabled": True})
    wav.write_bytes(b"RIFF" + b"night drive " * 300_000)    # several pieces
    me = _pair(desk, phone)
    # what travels: no names, no song bytes, no key
    r, _ = me.raw("/phone/projects")
    assert b"Night Drive" not in r.content
    r, _ = me.raw("/phone/song", {"path": str(wav)})
    assert b"night drive" not in r.content and len(r.content) > 3_600_000
    assert me.secret.hex() not in str(r.headers) and me.secret.hex() in str(app.state.catalog.get_setting("phone"))
    assert me.song(str(wav)) == wav.read_bytes()


def test_signed_requests_cant_be_faked_or_replayed(tmp_path, monkeypatch):
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    desk.put("/api/phone", json={"enabled": True})
    me = _pair(desk, phone)
    h = me.headers("/phone/hello")
    assert phone.get("/phone/hello", headers=h).status_code == 200
    assert phone.get("/phone/hello", headers=h).status_code == 401              # replayed
    h = me.headers("/phone/hello")
    assert phone.get("/phone/albums", headers=h).status_code == 401             # moved to another route
    old = me.headers("/phone/hello", when=int(time.time()) - 3600)
    assert phone.get("/phone/hello", headers=old).status_code == 401            # too old
    forged = {**me.headers("/phone/hello"), "X-LC-Sign": "0" * 64}
    assert phone.get("/phone/hello", headers=forged).status_code == 401
    # the old bearer key style is gone
    assert phone.get("/phone/hello", headers={"Authorization": f"Bearer {me.secret.hex()}"}).status_code == 401


def test_pairing_needs_the_secret_in_the_picture(tmp_path, monkeypatch):
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    desk.put("/api/phone", json={"enabled": True})
    link = desk.post("/api/phone/code").json()["link"]
    code = parse_qs(urlparse(link).query)["code"][0]
    # someone on the Wi-Fi who caught the code, but never saw the screen
    wrong = seal(secrets.token_bytes(32), b'{"name": "Not yours"}', f"pair:{code}".encode())
    assert phone.post("/phone/pair", json={"code": code, "locked": b64url(wrong)}).status_code == 403
    assert desk.get("/api/phone").json()["devices"] == []


def test_player_ticket_plays_only_that_song(tmp_path, monkeypatch):
    app, desk, phone, wav, secret = _setup(tmp_path, monkeypatch)
    desk.put("/api/phone", json={"enabled": True})
    me = _pair(desk, phone)
    until = str(int(time.time()) + 3600)
    sig = sign(me.signer, "song", str(wav), until)
    q = {"path": str(wav), "d": me.id, "until": until, "sig": sig}
    r = phone.get("/phone/play", params=q)
    assert r.status_code == 200 and r.content == wav.read_bytes()
    assert phone.get("/phone/play", params={**q, "path": str(secret)}).status_code == 401
    late = str(int(time.time()) + 30 * 24 * 3600)
    q2 = {**q, "until": late, "sig": sign(me.signer, "song", str(wav), late)}
    assert phone.get("/phone/play", params=q2).status_code == 401              # too long


def test_old_pairings_must_pair_again(tmp_path, monkeypatch):
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    app.state.catalog.set_setting("phone", {"enabled": True, "devices": [
        {"id": "old", "name": "Old phone", "key": "f" * 64, "paired_at": 1, "last_seen": 1}]})
    assert desk.get("/api/phone").json()["devices"] == []


def test_remove_and_switch_off_cut_the_phone_off(tmp_path, monkeypatch):
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    desk.put("/api/phone", json={"enabled": True})
    me = _pair(desk, phone)
    assert me.raw("/phone/hello")[0].status_code == 200

    desk.put("/api/phone", json={"enabled": False})
    assert me.raw("/phone/hello")[0].status_code == 401
    desk.put("/api/phone", json={"enabled": True})
    assert me.raw("/phone/hello")[0].status_code == 200

    assert desk.delete(f"/api/phone/devices/{me.id}").status_code == 200
    assert me.raw("/phone/hello")[0].status_code == 401
    assert desk.delete(f"/api/phone/devices/{me.id}").status_code == 404


def test_phone_sees_your_folders(tmp_path, monkeypatch):
    app, desk, phone, *_ = _setup(tmp_path, monkeypatch)
    desk.put("/api/phone", json={"enabled": True})
    me = _pair(desk, phone)
    desk.post("/api/folders", json={"name": "Club", "project_ids": ["p1", "gone"]})
    got = me.get("/phone/projects")
    assert [(f["name"], f["project_ids"]) for f in got["folders"]] == [("Club", ["p1"])]
