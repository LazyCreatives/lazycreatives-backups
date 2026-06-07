from fastapi.testclient import TestClient
from ablebackup.api.app import create_app


def _client(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")  # token="" disables auth for test
    return TestClient(app)


def test_settings_default_is_empty_config(tmp_path):
    c = _client(tmp_path)
    r = c.get("/api/settings")
    assert r.status_code == 200
    assert r.json() == {"sources": [], "dest": "", "interval_minutes": 0, "libraries": []}


def test_put_settings_persists(tmp_path):
    c = _client(tmp_path)
    payload = {"sources": ["C:/Music"], "dest": "Z:/", "interval_minutes": 30, "libraries": []}
    r = c.put("/api/settings", json=payload)
    assert r.status_code == 200
    assert c.get("/api/settings").json() == payload


def test_put_settings_configures_scheduler(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")
    c = TestClient(app)
    with c:  # triggers startup/shutdown events
        c.put("/api/settings", json={"sources": ["X"], "dest": "Z:/",
                                     "interval_minutes": 15})
        assert app.state.scheduler.job_count() == 1
        c.put("/api/settings", json={"sources": ["X"], "dest": "Z:/",
                                     "interval_minutes": 0})
        assert app.state.scheduler.job_count() == 0
