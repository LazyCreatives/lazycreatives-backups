"""A NAS that refuses the saved login counts as a missing backup place, not a crash."""
from pathlib import Path

from ablebackup import netpaths


def _refuse(code):
    def stat(self, *a, **k):
        e = OSError(22, "The user name or password is incorrect")
        e.winerror = code
        raise e
    return stat


def test_a_refused_network_folder_is_not_there(monkeypatch):
    netpaths.install()
    for cls in {Path, type(Path("."))}:
        monkeypatch.setattr(cls, "stat", _refuse(1326))
    p = Path("/nas/Backups")
    assert p.exists() is False and p.is_dir() is False


def test_other_errors_still_show(monkeypatch):
    for cls in {Path, type(Path("."))}:
        monkeypatch.setattr(cls, "stat", _refuse(5))
    try:
        Path("/nas/Backups").is_dir()
    except OSError:
        return
    raise AssertionError("an unrelated error was swallowed")


def test_a_screen_gets_a_plain_answer_when_the_nas_refuses(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from ablebackup.api.app import create_app
    from ablebackup import service
    app = create_app(token="", db_path=tmp_path / "c.db")

    def refuse(*a, **k):
        e = OSError(22, "The user name or password is incorrect")
        e.winerror = 1326
        raise e
    monkeypatch.setattr(service, "build_overview", refuse)
    monkeypatch.setattr("ablebackup.api.app.build_overview", refuse, raising=False)
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/overview")
    assert r.status_code == 503 and "NAS" in r.json()["detail"]
