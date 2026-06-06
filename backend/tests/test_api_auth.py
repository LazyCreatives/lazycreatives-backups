from fastapi.testclient import TestClient
from ablebackup.api.app import create_app


def _client(tmp_path, token="secret"):
    app = create_app(token=token, db_path=tmp_path / "c.db")
    return TestClient(app)


def test_health_needs_no_token(tmp_path):
    c = _client(tmp_path)
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_protected_route_rejects_missing_token(tmp_path):
    c = _client(tmp_path)
    r = c.get("/api/settings")
    assert r.status_code == 401


def test_protected_route_accepts_valid_token(tmp_path):
    c = _client(tmp_path)
    r = c.get("/api/settings", headers={"X-Auth-Token": "secret"})
    assert r.status_code == 200
