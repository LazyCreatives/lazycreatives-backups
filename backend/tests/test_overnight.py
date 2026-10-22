"""A long backup left running overnight: the computer is kept awake, and a NAS that
drops off part way is connected again instead of stopping the whole backup."""
import shutil
import sys
from pathlib import Path

from ablebackup import awake, nas, service
from ablebackup.catalog import Catalog
from ablebackup.service import run_backup
from tests.helpers import fileref_rel, write_als


def _projects(root: Path, names) -> None:
    for n in names:
        proj = root / f"{n} Project"
        (proj / "Samples").mkdir(parents=True)
        (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
        write_als(proj / f"{n}.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def _nas(tmp_path):
    cat = Catalog(tmp_path / "data" / "c.db")
    share = tmp_path / "Volumes" / "Music"
    share.mkdir(parents=True)
    nas.remember(cat, host="tnas.local", address="192.168.1.20", share="Music", user="rob",
                 password="pw", path=share, name="TNAS")
    dest = share / nas.SUBDIR
    dest.mkdir()
    cat.set_setting("config", {"sources": [], "dest": str(dest)})
    src = tmp_path / "music"
    _projects(src, ["Alpha", "Bravo", "Charlie"])
    return cat, share, dest, src


def test_nas_dropping_off_part_way_is_reconnected_and_the_backup_carries_on(tmp_path, monkeypatch):
    cat, share, dest, src = _nas(tmp_path)
    real = service.backup_project
    calls = []

    def flaky(p, *a, **k):
        calls.append(p.name)
        if len(calls) == 2:              # the NAS goes to sleep during the 2nd project
            shutil.rmtree(dest)
            raise OSError("Input/output error")
        return real(p, *a, **k)

    woke = []
    monkeypatch.setattr(service, "backup_project", flaky)
    monkeypatch.setattr(nas, "ensure_connected", lambda c, d, **k: woke.append(d) or dest.mkdir() or True)
    res = run_backup([src], dest, cat)
    assert woke == [dest]
    assert res["ok_count"] == 3 and res["error_count"] == 0
    assert calls[1] == calls[2]          # the project that hit the drop was tried again


def test_nas_that_stays_away_still_stops_the_backup(tmp_path, monkeypatch):
    cat, share, dest, src = _nas(tmp_path)

    def gone(p, *a, **k):
        shutil.rmtree(dest, ignore_errors=True)
        raise OSError("Input/output error")

    monkeypatch.setattr(service, "backup_project", gone)
    monkeypatch.setattr(nas, "ensure_connected", lambda c, d, **k: False)
    res = run_backup([src], dest, cat)
    assert res["ok_count"] == 0 and res["error_count"] == 1  # stopped, not 3 failures


def test_ordinary_project_error_is_not_retried(tmp_path, monkeypatch):
    cat, share, dest, src = _nas(tmp_path)
    tried = []
    monkeypatch.setattr(nas, "ensure_connected", lambda c, d, **k: tried.append(d) or True)
    real = service.backup_project

    def broken(p, *a, **k):
        if p.name.startswith("Bravo"):
            raise ValueError("bad project")
        return real(p, *a, **k)

    monkeypatch.setattr(service, "backup_project", broken)
    res = run_backup([src], dest, cat)
    assert tried == [] and res["ok_count"] == 2 and res["error_count"] == 1


def test_computer_is_kept_awake_only_while_backing_up(monkeypatch):
    started, stopped = [], []

    class Proc:
        def __init__(self, cmd, **k):
            started.append(cmd)

        def terminate(self):
            stopped.append(True)

        def wait(self, timeout=None):
            return 0

    monkeypatch.setattr(awake.subprocess, "Popen", Proc)
    monkeypatch.setattr(sys, "platform", "darwin")
    with awake.keep_awake():
        assert started and started[0][:2] == ["caffeinate", "-i"]
        assert not stopped
    assert stopped == [True]


def test_no_way_to_keep_awake_still_backs_up(monkeypatch):
    def missing(*a, **k):
        raise FileNotFoundError("systemd-inhibit")

    monkeypatch.setattr(awake.subprocess, "Popen", missing)
    monkeypatch.setattr(sys, "platform", "linux")
    ran = []
    with awake.keep_awake():
        ran.append(1)
    assert ran == [1]
