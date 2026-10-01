import os
import threading

from ablebackup.server import (
    _parent_alive,
    build_app_from_env,
    install_parent_watchdog,
    read_config,
)


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


def test_read_config_parent_pid(monkeypatch):
    monkeypatch.setenv("ABLEBACKUP_PARENT_PID", "4321")
    assert read_config()["parent_pid"] == 4321


def test_read_config_parent_pid_absent(monkeypatch):
    monkeypatch.delenv("ABLEBACKUP_PARENT_PID", raising=False)
    assert read_config()["parent_pid"] is None


def test_parent_alive_true_for_self():
    assert _parent_alive(os.getpid()) is True


def test_parent_watchdog_fires_when_parent_gone():
    fired = threading.Event()
    install_parent_watchdog(
        424242, poll_interval=0.01, on_dead=fired.set, alive=lambda pid: False
    )
    assert fired.wait(timeout=1.0)


def test_parent_watchdog_quiet_while_parent_alive():
    fired = threading.Event()
    install_parent_watchdog(
        424242, poll_interval=0.01, on_dead=fired.set, alive=lambda pid: True
    )
    assert not fired.wait(timeout=0.1)
