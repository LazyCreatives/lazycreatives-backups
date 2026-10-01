from ablebackup.catalog import Catalog


def _seed(cat):
    cat.record_snapshot("Alpha", "2026-06-01_1000", 100, 5, "ok", [])
    cat.record_snapshot("Alpha", "2026-06-02_1000", 120, 6, "ok", ["x.wav"])
    cat.record_snapshot("Beta", "2026-06-03_1000", 50, 2, "error", [], error="NAS down")


def test_recent_snapshots_newest_first(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    _seed(cat)
    rows = cat.recent_snapshots(limit=2)
    assert [r["timestamp"] for r in rows] == ["2026-06-03_1000", "2026-06-02_1000"]
    assert rows[0]["project_name"] == "Beta"
    assert rows[0]["status"] == "error"
    cat.close()


def test_projects_summary_aggregates(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    _seed(cat)
    summary = cat.projects_summary()
    by_name = {p["project_name"]: p for p in summary}
    assert by_name["Alpha"]["snapshot_count"] == 2
    assert by_name["Alpha"]["last_timestamp"] == "2026-06-02_1000"
    assert by_name["Beta"]["snapshot_count"] == 1
    # alphabetical by project name
    assert [p["project_name"] for p in summary] == ["Alpha", "Beta"]
    cat.close()
