from fastapi.testclient import TestClient
from ablebackup.api.app import create_app


def _client(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")
    c = TestClient(app)
    cat = app.state.catalog
    cat.record_snapshot("Alpha", "2026-06-01_1000", 100, 5, "ok", [])
    cat.record_snapshot("Alpha", "2026-06-02_1000", 120, 6, "ok", ["x.wav"])
    cat.record_snapshot("Beta", "2026-06-03_1000", 50, 2, "ok", [])
    return c


def test_history_returns_recent_newest_first(tmp_path):
    c = _client(tmp_path)
    rows = c.get("/api/history").json()["snapshots"]
    assert rows[0]["project_name"] == "Beta"
    assert rows[0]["timestamp"] == "2026-06-03_1000"


def test_projects_summary_endpoint(tmp_path):
    c = _client(tmp_path)
    projects = c.get("/api/projects").json()["projects"]
    by = {p["project_name"]: p for p in projects}
    assert by["Alpha"]["snapshot_count"] == 2


def test_project_detail_includes_missing(tmp_path):
    c = _client(tmp_path)
    detail = c.get("/api/projects/Alpha").json()
    assert len(detail["snapshots"]) == 2
    second = [s for s in detail["snapshots"] if s["timestamp"] == "2026-06-02_1000"][0]
    assert second["missing"] == ["x.wav"]


def test_project_detail_includes_snapshot_dir(tmp_path):
    c = _client(tmp_path)
    c.put("/api/settings", json={"sources": [], "dest": "/Volumes/NAS", "interval_minutes": 0})
    detail = c.get("/api/projects/Alpha").json()
    # normalise separators so the assertion holds on Windows too (dir is OS-native)
    dirs = {s["timestamp"]: s["dir"].replace("\\", "/") for s in detail["snapshots"]}
    assert dirs["2026-06-01_1000"] == "/Volumes/NAS/AbletonBackups/projects/Alpha/2026-06-01_1000"
