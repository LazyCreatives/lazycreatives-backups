"""API tests for the cloud-connect endpoints. rclone is monkeypatched so these are
deterministic whether or not a real rclone is installed."""
from fastapi.testclient import TestClient

from ablebackup.api.app import create_app


def _client(tmp_path):
    return TestClient(create_app(token="", db_path=tmp_path / "c.db"))


def _make_studio(c):
    r = c.post("/api/entitlement/activate", json={"key": "LC-STUDIO-DEMO-2026"})
    assert r.json()["features"]["cloud_backup"] is True


class _FakeSession:
    def __init__(self, provider, name, **_):
        self.provider_key, self.name = provider, name
        self.status, self.auth_url, self.error = "pending", None, None

    def start(self):
        self.auth_url = "http://127.0.0.1:53682/auth?state=xyz"

    def wait_for_url(self, _timeout):
        return self.auth_url

    def cancel(self):
        pass


def test_cloud_providers_lists_all(tmp_path):
    c = _client(tmp_path)
    keys = {p["key"] for p in c.get("/api/cloud/providers").json()["providers"]}
    assert {"drive", "dropbox", "onedrive"} <= keys


def test_cloud_connect_requires_studio(tmp_path):
    c = _client(tmp_path)  # default tier is free
    r = c.post("/api/cloud/connect", json={"provider": "drive"})
    assert r.status_code == 403


def test_cloud_connect_unknown_provider(tmp_path):
    c = _client(tmp_path)
    _make_studio(c)
    r = c.post("/api/cloud/connect", json={"provider": "nope"})
    assert r.status_code == 400


def test_cloud_connect_503_without_rclone(tmp_path, monkeypatch):
    monkeypatch.setattr("ablebackup.api.app.rclone_available", lambda: False)
    c = _client(tmp_path)
    _make_studio(c)
    r = c.post("/api/cloud/connect", json={"provider": "drive"})
    assert r.status_code == 503


def test_cloud_connect_returns_auth_url_and_status(tmp_path, monkeypatch):
    monkeypatch.setattr("ablebackup.api.app.rclone_available", lambda: True)
    monkeypatch.setattr("ablebackup.api.app.rclone_remotes", lambda: [])
    monkeypatch.setattr("ablebackup.api.app.CloudConnectSession", _FakeSession)
    c = _client(tmp_path)
    _make_studio(c)

    r = c.post("/api/cloud/connect", json={"provider": "drive"})
    assert r.status_code == 200
    body = r.json()
    assert body["auth_url"].startswith("http://127.0.0.1:")
    assert body["remote"] == "drive"
    cid = body["connect_id"]

    s = c.get(f"/api/cloud/connect/{cid}")
    assert s.status_code == 200
    assert s.json()["status"] == "pending"

    assert c.get("/api/cloud/connect/does-not-exist").status_code == 404
