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


def test_cors_preflight_is_allowed(tmp_path):
    # The Electron renderer is a different origin than the sidecar, so the browser
    # sends an OPTIONS preflight before any GET/PUT/POST with custom headers.
    c = _client(tmp_path)
    r = c.options("/api/settings", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-auth-token",
    })
    assert r.status_code == 200
    # CORS is now scoped to the renderer's real origins (not "*"), so it echoes back
    # the specific allowed origin.
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
