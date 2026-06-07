from fastapi.testclient import TestClient

from ablebackup.api.app import create_app


def _client(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")
    return TestClient(app), app.state.catalog


def test_default_tier_is_free(tmp_path):
    c, _ = _client(tmp_path)
    d = c.get("/api/entitlement").json()
    assert d["tier"] == "free"
    assert d["features"]["scheduled"] is False
    assert d["features"]["restore"] is False
    assert d["features"]["multi_daw"] is False


def test_activate_pro_key_unlocks(tmp_path):
    c, _ = _client(tmp_path)
    d = c.post("/api/entitlement/activate", json={"key": "lc-pro-demo-2026"}).json()
    assert d["tier"] == "pro"
    assert d["features"]["restore"] is True
    assert c.get("/api/entitlement").json()["tier"] == "pro"  # persisted


def test_bad_key_rejected(tmp_path):
    c, _ = _client(tmp_path)
    assert c.post("/api/entitlement/activate", json={"key": "nope"}).status_code == 400


def test_cloud_backup_is_studio_only(tmp_path):
    c, _ = _client(tmp_path)
    pro = c.post("/api/entitlement/activate", json={"key": "LC-PRO-DEMO-2026"}).json()
    assert pro["features"]["cloud_backup"] is False  # Pro = local destinations only
    studio = c.post("/api/entitlement/activate", json={"key": "LC-STUDIO-DEMO-2026"}).json()
    assert studio["features"]["cloud_backup"] is True  # offsite/cloud is the top tier


def test_free_cannot_schedule_but_pro_can(tmp_path):
    c, _ = _client(tmp_path)
    free = c.put("/api/settings", json={"sources": [], "dest": "/x", "interval_minutes": 60, "libraries": []}).json()
    assert free["interval_minutes"] == 0  # scheduling clamped off for Free

    c.post("/api/entitlement/activate", json={"key": "LC-PRO-DEMO-2026"})
    pro = c.put("/api/settings", json={"sources": [], "dest": "/x", "interval_minutes": 60, "libraries": []}).json()
    assert pro["interval_minutes"] == 60


def test_free_restore_is_blocked(tmp_path):
    c, cat = _client(tmp_path)
    cat.record_snapshot("S", "2026-06-01_1000", 1, 1, "ok", [], dir=str(tmp_path))
    sid = cat.snapshots_for("S")[0]["id"]
    r = c.post("/api/restore", json={"snapshot_id": sid, "target": str(tmp_path / "out")})
    assert r.status_code == 402  # Pro feature
