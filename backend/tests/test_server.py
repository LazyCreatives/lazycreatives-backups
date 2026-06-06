from ablebackup.server import build_app_from_env, read_config


def test_read_config_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ABLEBACKUP_TOKEN", "tok")
    monkeypatch.setenv("ABLEBACKUP_PORT", "8123")
    monkeypatch.setenv("ABLEBACKUP_DB", str(tmp_path / "c.db"))
    cfg = read_config()
    assert cfg["token"] == "tok"
    assert cfg["port"] == 8123
    assert cfg["db_path"] == str(tmp_path / "c.db")


def test_read_config_defaults(monkeypatch):
    monkeypatch.delenv("ABLEBACKUP_TOKEN", raising=False)
    monkeypatch.delenv("ABLEBACKUP_PORT", raising=False)
    monkeypatch.delenv("ABLEBACKUP_DB", raising=False)
    cfg = read_config()
    assert cfg["token"] == ""
    assert cfg["port"] == 8753
    assert cfg["db_path"].endswith("catalog.db")


def test_build_app_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ABLEBACKUP_TOKEN", "tok")
    monkeypatch.setenv("ABLEBACKUP_DB", str(tmp_path / "c.db"))
    app = build_app_from_env()
    assert app.state.token == "tok"
    app.state.catalog.close()
    app.state.scheduler.shutdown()
