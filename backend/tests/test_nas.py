"""Finding and connecting a NAS, and waking it up again before a backup."""
from pathlib import Path

import pytest

from ablebackup import nas, secretbox
from ablebackup.catalog import Catalog


@pytest.mark.parametrize("text,host,share", [
    ("\\\\TNAS\\Music", "TNAS", "Music"),
    ("smb://192.168.1.20/Music Backups", "192.168.1.20", "Music Backups"),
    ("smb://rob@nas.local/", "nas.local", ""),
    ("  tnas.local  ", "tnas.local", ""),
])
def test_pasted_addresses(text, host, share):
    assert nas.clean_host(text) == host
    assert nas.share_in(text) == share


def test_nonsense_address_says_what_to_type():
    with pytest.raises(nas.NasError, match="192.168.1.20"):
        nas.clean_host("my nas please")


def test_makers_are_named():
    assert nas.maker_of("TNAS-F4", "") == "TerraMaster"
    assert nas.maker_of("DiskStation", "DS920+ synology") == "Synology"
    assert nas.maker_of("living-room", "") == ""


def test_saved_login_is_locked_and_comes_back(tmp_path):
    stored = secretbox.lock("s3cret pass", tmp_path)
    assert "s3cret" not in stored
    assert secretbox.unlock(stored, tmp_path) == "s3cret pass"
    assert secretbox.unlock("aesgcm:garbage", tmp_path) is None
    assert secretbox.unlock(None, tmp_path) is None


def _remembered(tmp_path):
    cat = Catalog(tmp_path / "data" / "c.db")
    share = tmp_path / "Volumes" / "Music"
    nas.remember(cat, host="tnas.local", address="192.168.1.20", share="Music", user="rob",
                 password="pw", path=share, name="TNAS")
    dest = share / nas.SUBDIR
    cat.set_setting("config", {"sources": [], "dest": str(dest)})
    return cat, share, dest


def test_backup_folder_on_the_nas_is_known(tmp_path):
    cat, share, dest = _remembered(tmp_path)
    assert nas.on_nas(cat, dest)["name"] == "TNAS"
    assert nas.on_nas(cat, tmp_path / "elsewhere") is None
    assert cat.get_setting(nas.SECRET_KEY).startswith(("aesgcm:", "dpapi:"))


def test_asleep_nas_is_connected_again_with_the_saved_login(tmp_path, monkeypatch):
    cat, share, dest = _remembered(tmp_path)
    calls = []

    def fake_connect(host, sh, user, password):
        calls.append((host, sh, user, password))
        if len(calls) < 3:
            raise nas.NasError("asleep")
        dest.mkdir(parents=True)  # it woke up
        return share

    monkeypatch.setattr(nas, "connect", fake_connect)
    assert nas.ensure_connected(cat, dest, wait=5, step=0.01) is True
    assert calls[0] == ("tnas.local", "Music", "rob", "pw")
    assert len(calls) == 3


def test_nas_that_never_wakes_gives_up(tmp_path, monkeypatch):
    cat, share, dest = _remembered(tmp_path)
    monkeypatch.setattr(nas, "connect", lambda *a: (_ for _ in ()).throw(nas.NasError("no")))
    assert nas.ensure_connected(cat, dest, wait=0.05, step=0.01) is False


def test_nas_back_at_a_new_place_is_followed(tmp_path, monkeypatch):
    cat, share, dest = _remembered(tmp_path)
    moved = tmp_path / "Volumes" / "Music-1"
    (moved / nas.SUBDIR).mkdir(parents=True)
    monkeypatch.setattr(nas, "connect", lambda *a: moved)
    assert nas.ensure_connected(cat, dest, wait=1, step=0.01) is True
    assert cat.get_setting("config")["dest"] == str(moved / nas.SUBDIR)
    assert nas.remembered(cat)["path"] == str(moved)


def test_backup_reconnects_then_reports_missing_if_still_asleep(tmp_path, monkeypatch):
    from ablebackup.service import BackupDriveMissing, run_backup
    cat, share, dest = _remembered(tmp_path)
    tried = []
    monkeypatch.setattr(nas, "ensure_connected", lambda c, d, **k: tried.append(d) or False)
    with pytest.raises(BackupDriveMissing):
        run_backup([tmp_path / "src"], dest, cat)
    assert tried == [dest]
    assert not dest.exists()  # nothing was made on the computer's own disk


def test_scheduler_tries_a_sleeping_nas_again_later(tmp_path, monkeypatch):
    from ablebackup import scheduler as sched
    cat, share, dest = _remembered(tmp_path)
    cat.set_setting("config", {"sources": [str(tmp_path)], "dest": str(dest)})
    monkeypatch.setattr(nas, "ensure_connected", lambda c, d, **k: False)
    s = sched.BackupScheduler(cat)
    try:
        s._run_once()
        assert s._scheduler.get_job(sched._RETRY_ID) is not None
        assert cat.get_setting("nas_retry")
        s._run_once()  # a second miss doesn't stack another retry
        assert len([j for j in s._scheduler.get_jobs() if j.id == sched._RETRY_ID]) == 1
    finally:
        s.shutdown()


def test_nas_api(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from ablebackup.api.app import create_app
    share = tmp_path / "Volumes" / "Music"
    share.mkdir(parents=True)
    monkeypatch.setattr(nas, "discover", lambda: [{"name": "TNAS", "host": "tnas.local", "address": "192.168.1.20", "maker": "TerraMaster"}])
    monkeypatch.setattr(nas, "tailscale", lambda: {"installed": False, "running": False, "peers": []})

    def shares(host, user, pw):
        if pw != "pw":
            raise nas.NasError("That name or password didn't work on the NAS.")
        return [{"name": "Music", "comment": ""}]
    monkeypatch.setattr(nas, "list_shares", shares)
    monkeypatch.setattr(nas, "connect", lambda *a: share)
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        assert c.post("/api/nas/find").json()["found"][0]["maker"] == "TerraMaster"
        bad = c.post("/api/nas/shares", json={"host": "tnas.local", "user": "rob", "password": "x"})
        assert bad.status_code == 400 and "password" in bad.json()["detail"]
        ok = c.post("/api/nas/shares", json={"host": "\\\\tnas.local\\Music", "user": "rob", "password": "pw"}).json()
        assert ok["host"] == "tnas.local" and ok["pasted_share"] == "Music"
        r = c.post("/api/nas/connect", json={"host": "tnas.local", "share": "Music", "user": "rob",
                                              "password": "pw", "name": "TNAS"}).json()
        assert r["dest"] == str(share / nas.SUBDIR) and (share / nas.SUBDIR).is_dir()
        st = c.get("/api/nas").json()
        assert st["nas"]["name"] == "TNAS" and st["connected"] is True and "password" not in st["nas"]
        c.post("/api/nas/forget")
        assert c.get("/api/nas").json()["nas"] is None


def _fake_cli(tmp_path, name, body):
    p = tmp_path / name
    p.write_text("#!/bin/sh\n" + body)
    p.chmod(0o755)
    return str(p)


def test_nas_away_from_home_shows_through_tailscale(tmp_path, monkeypatch):
    import json
    status = {"BackendState": "Running", "Peer": {
        "a": {"HostName": "TNAS", "DNSName": "tnas.tail1234.ts.net.", "TailscaleIPs": ["100.101.1.2", "fd7a::1"], "Online": True, "OS": "linux"},
        "b": {"HostName": "Robs-iPhone", "DNSName": "robs-iphone.tail1234.ts.net.", "TailscaleIPs": ["100.101.1.3"], "Online": True, "OS": "iOS"},
        "c": {"HostName": "old-pc", "DNSName": "old-pc.tail1234.ts.net.", "TailscaleIPs": ["100.101.1.4"], "Online": False, "OS": "windows"},
    }}
    (tmp_path / "s.json").write_text(json.dumps(status))
    monkeypatch.setattr(nas, "tailscale_cli", lambda: _fake_cli(tmp_path, "tailscale", f"cat {tmp_path}/s.json\n"))
    t = nas.tailscale()
    assert t["installed"] and t["running"]
    assert t["peers"] == [{"name": "TNAS", "host": "tnas.tail1234.ts.net", "address": "100.101.1.2",
                           "maker": "TerraMaster", "away": True}]


def test_no_tailscale_says_so(monkeypatch):
    monkeypatch.setattr(nas, "tailscale_cli", lambda: None)
    assert nas.tailscale() == {"installed": False, "running": False, "peers": []}


def test_nas_by_internet_address_becomes_a_second_copy(tmp_path):
    log = tmp_path / "log"
    rc = _fake_cli(tmp_path, "rclone", f'echo "$@" >> {log}\nexit 0\n')
    where = nas.add_remote("sftp", "myhouse.example.com", None, "rob", "pw", "Music", rc, ["tnas"])
    assert where == "myhouse:Music/LazyCreatives-Backups"
    calls = log.read_text().splitlines()
    assert calls[0].startswith("config create myhouse sftp host=myhouse.example.com port=22 user=rob pass=pw --obscure")
    assert calls[1].startswith("mkdir myhouse:Music/LazyCreatives-Backups")


def test_nas_address_that_refuses_is_not_kept(tmp_path):
    log = tmp_path / "log"
    rc = _fake_cli(tmp_path, "rclone", f'echo "$@" >> {log}\ncase "$1" in mkdir) exit 1;; esac\nexit 0\n')
    with pytest.raises(nas.NasError, match="couldn't get in to"):
        nas.add_remote("webdav", "myhouse.example.com", 5006, "rob", "pw", "", rc, [])
    calls = log.read_text().splitlines()
    assert "url=https://myhouse.example.com:5006" in calls[0]
    assert calls[-1].startswith("config delete myhouse")


def test_no_rclone_says_what_to_do():
    with pytest.raises(nas.NasError, match="rclone"):
        nas.add_remote("sftp", "h.example.com", None, "u", "p", "", None, [])


@pytest.mark.parametrize("typed,expect", [
    ("robert", ("", "robert")),
    ("  robert ", ("", "robert")),
    ("TNAS\\robert", ("TNAS", "robert")),
    ("robert@TNAS", ("TNAS", "robert")),
    ("rob@example.com", ("", "rob@example.com")),
])
def test_user_names_with_the_nas_in_front(typed, expect):
    assert nas.split_user(typed) == expect


class _FakeSMB:
    """Stands in for pysmb: takes the login only with the domain in `ok_domain`."""
    tried: list = []
    ok_domain = ""
    blow_up = False

    def __init__(self, user, password, my_name, remote_name, domain="", **kw):
        self.domain, self.user = domain, user

    def connect(self, ip, port, timeout=0):
        _FakeSMB.tried.append((self.user, self.domain))
        if _FakeSMB.blow_up:
            raise RuntimeError("SMB dialect not supported")
        return self.domain == _FakeSMB.ok_domain

    def listShares(self, timeout=0):
        class S:
            name, comments, isSpecial, isTemporary, type = "Music", "", False, False, 0
        return [S()]

    def close(self):
        pass


@pytest.fixture
def fake_smb(monkeypatch):
    import smb.SMBConnection
    monkeypatch.setattr(smb.SMBConnection, "SMBConnection", _FakeSMB)
    monkeypatch.setattr(nas, "_resolve", lambda h: "192.168.1.20")
    _FakeSMB.tried, _FakeSMB.ok_domain, _FakeSMB.blow_up = [], "", False
    return _FakeSMB


def test_login_is_tried_with_the_workgroup_and_nas_name_before_saying_its_wrong(fake_smb):
    fake_smb.ok_domain = "TNAS"
    assert nas.list_shares("tnas.local", " robert ", "pw") == [{"name": "Music", "comment": ""}]
    assert fake_smb.tried == [("robert", ""), ("robert", "WORKGROUP"), ("robert", "TNAS")]


def test_a_really_wrong_login_still_says_so(fake_smb):
    fake_smb.ok_domain = "nope"
    with pytest.raises(nas.NasError, match="name or password"):
        nas.list_shares("tnas.local", "robert", "bad")


def test_a_nas_this_app_cant_talk_to_is_not_called_a_wrong_password(fake_smb):
    fake_smb.blow_up = True
    assert nas.list_shares("tnas.local", "robert", "pw") is None


def test_shares_api_says_when_the_folder_name_must_be_typed(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from ablebackup.api.app import create_app
    monkeypatch.setattr(nas, "list_shares", lambda *a: None)
    with TestClient(create_app(token="", db_path=tmp_path / "c.db")) as c:
        r = c.post("/api/nas/shares", json={"host": "tnas.local", "user": "rob", "password": "pw"}).json()
    assert r["listed"] is False and r["shares"] == []


@pytest.mark.parametrize("text,code", [
    ("System error 1326 has occurred.\r\n\r\nThe user name or password is incorrect.", 1326),
    ("Systemfehler 86 aufgetreten.", 86),
    ("\\\\192.168.1.86\\Music: System error 53 has occurred.", 53),
    ("", None),
])
def test_windows_error_numbers_are_read_in_any_language(text, code):
    assert nas._win_code(text) == code


def test_windows_tries_the_nas_name_in_front_of_the_user(monkeypatch):
    import subprocess
    calls = []

    def fake_run(args, **kw):
        calls.append(args)
        ok = args[4] == "/user:TNAS\\robert"
        return subprocess.CompletedProcess(args, 0 if ok else 2, "", "" if ok else "System error 1326 has occurred.")
    monkeypatch.setattr(nas, "_WIN", True)
    monkeypatch.setattr(nas, "mount_path", lambda h, s: None)
    monkeypatch.setattr(nas, "_run", fake_run)
    assert str(nas.connect("TNAS", "Music", "robert", "pw")) == str(Path("\\\\TNAS\\Music"))
    assert [a[4] for a in calls] == ["/user:robert", "/user:TNAS\\robert"]
