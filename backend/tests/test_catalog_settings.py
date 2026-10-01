from ablebackup.catalog import Catalog


def test_set_get_setting_roundtrips_json(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    cat.set_setting("config", {"sources": ["A", "B"], "dest": "Z:\\", "interval_minutes": 60})
    assert cat.get_setting("config") == {"sources": ["A", "B"], "dest": "Z:\\", "interval_minutes": 60}
    cat.close()


def test_get_setting_returns_default_when_absent(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    assert cat.get_setting("missing", default={"x": 1}) == {"x": 1}
    assert cat.get_setting("missing") is None
    cat.close()


def test_set_setting_overwrites(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    cat.set_setting("k", 1)
    cat.set_setting("k", 2)
    assert cat.get_setting("k") == 2
    cat.close()


def test_settings_persist_across_instances(tmp_path):
    db = tmp_path / "c.db"
    c1 = Catalog(db)
    c1.set_setting("config", {"sources": ["A"]})
    c1.close()
    c2 = Catalog(db)
    assert c2.get_setting("config") == {"sources": ["A"]}
    c2.close()
