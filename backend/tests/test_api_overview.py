from fastapi.testclient import TestClient
from ablebackup.api.app import create_app


def _client(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")
    return TestClient(app), app.state.catalog


def test_overview_empty(tmp_path):
    c, _ = _client(tmp_path)
    data = c.get("/api/overview").json()
    assert data["projects_protected"] == 0
    assert data["snapshot_count"] == 0
    assert data["attention"] == []
    assert data["last_run"] is None
    assert data["nas"]["reachable"] is False


def test_overview_totals_and_attention(tmp_path):
    c, cat = _client(tmp_path)
    cat.record_snapshot("Alpha", "2026-06-01_1000", 100, 5, "ok", [])
    cat.record_snapshot("Alpha", "2026-06-02_1000", 120, 6, "ok", ["x.wav", "y.wav"])
    cat.record_snapshot("Beta", "2026-06-03_1000", 50, 2, "error", [], error="boom")

    data = c.get("/api/overview").json()
    assert data["projects_protected"] == 2
    assert data["snapshot_count"] == 3
    assert data["logical_size"] == 270
    # newest snapshot overall is Beta, which errored
    assert data["last_run"] == "2026-06-03_1000"
    assert data["last_run_ok"] is False

    by = {a["project_name"]: a for a in data["attention"]}
    assert by["Alpha"]["kind"] == "missing"
    assert "2" in by["Alpha"]["reason"]
    assert by["Beta"]["kind"] == "error"
    assert by["Beta"]["reason"] == "boom"


def test_overview_nas_reachable_and_dedup(tmp_path):
    c, cat = _client(tmp_path)
    cat.record_snapshot("Alpha", "2026-06-01_1000", 1000, 5, "ok", [])
    # A real dest dir with a pool holding fewer bytes than the logical total.
    dest = tmp_path / "nas"
    pool = dest / "AbletonBackups" / "_pool" / "ab"
    pool.mkdir(parents=True)
    (pool / "abcd").write_bytes(b"x" * 200)
    cat.set_setting("config", {"sources": [], "dest": str(dest), "interval_minutes": 60})

    # Pool size is read from cache (computed in the background), so populate it first.
    from ablebackup.service import refresh_pool_cache
    refresh_pool_cache(cat, str(dest))

    data = c.get("/api/overview").json()
    assert data["nas"]["reachable"] is True
    assert data["pool_known"] is True
    assert data["actual_size"] == 200
    assert data["saved_bytes"] == 800  # logical 1000 - actual 200
    assert data["schedule"] == {"enabled": True, "interval_minutes": 60, "next_run": None}


def test_overview_pool_unknown_until_cached(tmp_path):
    c, cat = _client(tmp_path)
    cat.record_snapshot("Alpha", "2026-06-01_1000", 1000, 5, "ok", [])
    data = c.get("/api/overview").json()
    assert data["pool_known"] is False     # no walk yet -> reported as not-yet-known
    assert data["saved_bytes"] == 0        # don't claim savings we haven't measured
