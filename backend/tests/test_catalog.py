from ablebackup.catalog import Catalog


def test_record_and_read_snapshot(tmp_path):
    cat = Catalog(tmp_path / "catalog.db")
    sid = cat.record_snapshot(
        project_name="Song",
        timestamp="2026-06-06_1430",
        total_size=1234,
        file_count=10,
        status="ok",
        missing=["Samples/gone.wav"],
    )
    rows = cat.snapshots_for("Song")
    assert len(rows) == 1
    assert rows[0]["timestamp"] == "2026-06-06_1430"
    assert rows[0]["file_count"] == 10
    assert cat.missing_for(sid) == ["Samples/gone.wav"]
    cat.close()


def test_catalog_persists_across_instances(tmp_path):
    db = tmp_path / "catalog.db"
    c1 = Catalog(db)
    c1.record_snapshot("S", "t1", 1, 1, "ok", [])
    c1.close()
    c2 = Catalog(db)
    assert len(c2.snapshots_for("S")) == 1
    c2.close()
