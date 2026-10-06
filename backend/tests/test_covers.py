"""Custom cover art: pictures, the main picture, per-project choices and the image route."""
import base64

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 20


def _url(raw, mime="image/png"):
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


def _client(tmp_path, token=""):
    return TestClient(create_app(token=token, db_path=tmp_path / "c.db"))


def _add(c, raw=PNG, mime="image/png", **kw):
    r = c.post("/api/covers/pictures", json={"data": _url(raw, mime), "w": 800, "h": 600, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_default_state(tmp_path):
    assert _client(tmp_path).get("/api/covers").json() == {
        "rule": "genre", "style": "ink", "pictures": [], "projects": {}}


def test_add_pictures_first_is_main(tmp_path):
    c = _client(tmp_path)
    s = _add(c, name="  Sunset  ")
    p = s["pictures"][0]
    assert p["name"] == "Sunset" and p["main"] is True and p["use"] == "background"
    assert (p["w"], p["h"], p["genres"]) == (800, 600, [])
    assert p["url"] == f"/api/covers/img/{p['id']}" and "file" not in p and len(p["id"]) == 12
    assert (tmp_path / "covers" / f"{p['id']}.png").read_bytes() == PNG
    s = _add(c, JPEG, "image/jpeg", use="full")
    q = s["pictures"][1]
    assert q["name"] == "Picture 2" and q["main"] is False and q["use"] == "full"
    assert (tmp_path / "covers" / f"{q['id']}.jpg").is_file()
    s = _add(c, WEBP, "image/webp", name="x" * 200)
    assert len(s["pictures"][2]["name"]) == 80
    assert c.get("/api/covers").json() == s


def test_patch_and_main_is_exclusive(tmp_path):
    c = _client(tmp_path)
    _add(c)
    s = _add(c)
    a, b = (p["id"] for p in s["pictures"])
    s = c.patch(f"/api/covers/pictures/{b}", json={
        "name": " Night ", "use": "full", "main": True,
        "genres": ["Techno", " techno ", "", "y" * 60] + [f"g{i}" for i in range(50)]}).json()
    pa, pb = s["pictures"]
    assert pa["main"] is False and pb["main"] is True
    assert pb["name"] == "Night" and pb["use"] == "full"
    assert pb["genres"][:3] == ["Techno", "techno", "y" * 40] and len(pb["genres"]) == 40
    s = c.patch(f"/api/covers/pictures/{a}", json={"main": True}).json()
    assert [p["main"] for p in s["pictures"]] == [True, False]
    s = c.patch(f"/api/covers/pictures/{a}", json={"main": False}).json()
    assert [p["main"] for p in s["pictures"]] == [False, False]
    assert c.patch("/api/covers/pictures/nope", json={"name": "x"}).status_code == 404
    assert c.patch(f"/api/covers/pictures/{a}", json={"use": "tiled"}).status_code == 422


def test_settings(tmp_path):
    c = _client(tmp_path)
    s = c.put("/api/covers/settings", json={"rule": "one"}).json()
    assert (s["rule"], s["style"]) == ("one", "ink")
    s = c.put("/api/covers/settings", json={"style": "strip"}).json()
    assert (s["rule"], s["style"]) == ("one", "strip")
    assert c.put("/api/covers/settings", json={"rule": "random"}).status_code == 422
    assert c.put("/api/covers/settings", json={"style": "neon"}).status_code == 422


def test_choice(tmp_path):
    c = _client(tmp_path)
    pid = _add(c)["pictures"][0]["id"]
    s = c.put("/api/covers/choice", json={"name": "Night Drive", "choice": {
        "pic": pid, "use": "full", "fx": 3, "fy": -1, "style": "photo"}}).json()
    assert s["projects"]["Night Drive"] == {"pic": pid, "use": "full", "fx": 1.0, "fy": 0.0,
                                            "style": "photo"}
    s = c.put("/api/covers/choice", json={"name": "Drawn", "choice": {"pic": None}}).json()
    assert s["projects"]["Drawn"] == {"pic": None, "use": None, "fx": 0.5, "fy": 0.5,
                                      "style": None}
    assert c.put("/api/covers/choice", json={"name": "X", "choice": {"pic": "nope"}}).status_code == 404
    assert c.put("/api/covers/choice", json={"name": "", "choice": None}).status_code == 422
    assert c.put("/api/covers/choice", json={"name": "y" * 301, "choice": None}).status_code == 422
    assert c.put("/api/covers/choice", json={"name": "X", "choice": {"style": "neon"}}).status_code == 422
    assert c.put("/api/covers/choice", json={"name": "X", "choice": {"use": "tiled"}}).status_code == 422
    s = c.put("/api/covers/choice", json={"name": "Drawn", "choice": None}).json()
    assert "Drawn" not in s["projects"] and "Night Drive" in s["projects"]


def test_delete_removes_file_and_choices(tmp_path):
    c = _client(tmp_path)
    _add(c)
    s = _add(c)
    a, b = (p["id"] for p in s["pictures"])
    c.put("/api/covers/choice", json={"name": "A", "choice": {"pic": a}})
    c.put("/api/covers/choice", json={"name": "B", "choice": {"pic": b}})
    c.put("/api/covers/choice", json={"name": "Drawn", "choice": {"pic": None}})
    s = c.delete(f"/api/covers/pictures/{a}").json()
    assert [p["id"] for p in s["pictures"]] == [b]
    assert set(s["projects"]) == {"B", "Drawn"}
    assert not (tmp_path / "covers" / f"{a}.png").exists()
    assert (tmp_path / "covers" / f"{b}.png").exists()
    assert c.delete(f"/api/covers/pictures/{a}").status_code == 404


def test_bad_data(tmp_path):
    c = _client(tmp_path)
    post = lambda data: c.post("/api/covers/pictures", json={"data": data, "w": 1, "h": 1})
    assert post("data:image/png;base64,@@@not-base64@@@").status_code == 400
    assert post(_url(b"GIF89a" + b"\x00" * 10, "image/gif")).status_code == 400
    assert post(_url(JPEG, "image/png")).status_code == 400   # bytes don't match the type
    assert post(_url(b"RIFF\x00\x00\x00\x00WAVE", "image/webp")).status_code == 400
    assert post("hello").status_code == 400
    assert post(_url(PNG + b"\x00" * (12 * 1024 * 1024))).status_code == 413
    assert c.get("/api/covers").json()["pictures"] == []


def test_img_needs_token(tmp_path):
    c = _client(tmp_path, token="secret")
    h = {"X-Auth-Token": "secret"}
    assert c.get("/api/covers").status_code == 401
    r = c.post("/api/covers/pictures", json={"data": _url(JPEG, "image/jpeg"), "w": 1, "h": 1},
               headers=h)
    pid = r.json()["pictures"][0]["id"]
    assert c.get(f"/api/covers/img/{pid}").status_code == 401
    assert c.get(f"/api/covers/img/{pid}?t=wrong").status_code == 401
    r = c.get(f"/api/covers/img/{pid}?t=secret")
    assert r.status_code == 200 and r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "max-age=31536000, immutable"
    assert c.get("/api/covers/img/nope?t=secret").status_code == 404
    assert c.get("/api/covers/img/..%2Fc.db?t=secret").status_code == 404
