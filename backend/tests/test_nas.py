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
    monkeypatch.setattr(nas, "_answers_smb", lambda ips, **k: {"100.101.1.2"} & set(ips))
    t = nas.tailscale()
    assert t["installed"] and t["running"]
    assert t["peers"] == [{"name": "TNAS", "host": "tnas.tail1234.ts.net", "address": "100.101.1.2",
                           "maker": "TerraMaster", "away": True}]


def test_a_nas_away_that_is_slow_to_answer_still_shows(tmp_path, monkeypatch):
    """Away from home the NAS's first answer can be slow; a NAS maker's box still shows,
    and a phone named with curly quotes doesn't stop the list being read."""
    import json
    status = {"BackendState": "Running", "Peer": {
        "a": {"HostName": "TNAS-F4", "DNSName": "tnas-f4.tail1234.ts.net.", "TailscaleIPs": ["100.90.248.35"], "Online": True, "OS": "linux"},
        "b": {"HostName": "Robert\u2019s laptop \U0001F3B5", "DNSName": "roberts-laptop.tail1234.ts.net.", "TailscaleIPs": ["100.90.1.9"], "Online": True, "OS": "windows"},
    }}
    (tmp_path / "s.json").write_bytes(json.dumps(status, ensure_ascii=False).encode("utf-8"))
    monkeypatch.setattr(nas, "tailscale_cli", lambda: _fake_cli(tmp_path, "tailscale", f"cat {tmp_path}/s.json\n"))
    waited = []
    monkeypatch.setattr(nas, "_answers_smb", lambda ips, timeout=0.8: waited.append(timeout) or set())
    t = nas.tailscale()
    assert t["running"] and waited[0] >= 3
    assert [f["name"] for f in t["peers"]] == ["TNAS-F4"]


def test_nas_behind_a_home_computer_sharing_its_network_over_tailscale(tmp_path, monkeypatch):
    import json
    status = {"BackendState": "Running", "Peer": {
        "a": {"HostName": "studio-mac", "DNSName": "studio-mac.tail1234.ts.net.", "TailscaleIPs": ["100.101.1.5"],
              "Online": True, "OS": "macOS", "PrimaryRoutes": ["192.168.1.0/24", "fd00::/64"]},
        "b": {"HostName": "router", "TailscaleIPs": ["100.101.1.6"], "Online": True, "OS": "linux",
              "PrimaryRoutes": ["0.0.0.0/0"]},   # an exit node: the whole internet, never scanned
    }}
    (tmp_path / "s.json").write_text(json.dumps(status))
    monkeypatch.setattr(nas, "tailscale_cli", lambda: _fake_cli(tmp_path, "tailscale", f"cat {tmp_path}/s.json\n"))
    asked = []
    monkeypatch.setattr(nas, "_answers_smb", lambda ips, **k: asked.append(len(ips)) or {"192.168.1.20"} & set(ips))
    monkeypatch.setattr(nas, "_reverse_names", lambda ips: ["TNAS-F4" for _ in ips])
    t = nas.tailscale()
    assert t["peers"] == [{"name": "TNAS-F4", "host": "192.168.1.20", "address": "192.168.1.20",
                           "maker": "TerraMaster", "away": True, "via": "studio-mac"}]
    assert asked == [2, 254]   # the two computers, then the one home network


def test_home_network_addresses():
    assert len(nas._hosts_in("192.168.1.0/24")) == 254
    assert nas._hosts_in("10.0.0.0/8") == [] and nas._hosts_in("nonsense") == []


def test_file_sharing_port_is_knocked(monkeypatch):
    import socket as s
    srv = s.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen()
    port = srv.getsockname()[1]
    real = nas.socket.create_connection
    monkeypatch.setattr(nas.socket, "create_connection", lambda addr, timeout: real(("127.0.0.1", port) if addr[0] == "127.0.0.1" else ("127.0.0.2", 9), timeout=timeout))
    try:
        assert nas._answers_smb(["127.0.0.1", "127.0.0.2"], timeout=0.3) == {"127.0.0.1"}
    finally:
        srv.close()


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


def test_windows_lets_go_of_an_old_link_that_no_longer_gets_in(monkeypatch):
    """1219 means Windows is already joined to the NAS; when that old link can't open the
    folder any more, it is dropped and the saved login is used afresh."""
    import subprocess
    calls, dropped = [], []

    def fake_run(args, **kw):
        calls.append(args)
        if args == ["net", "use"]:
            return subprocess.CompletedProcess(args, 0, "OK   \\\\TNAS\\BACKUPS   Microsoft Windows Network\n", "")
        if "/delete" in args:
            dropped.append(args[2])
            return subprocess.CompletedProcess(args, 0, "", "")
        fresh = bool(dropped)
        return subprocess.CompletedProcess(args, 0 if fresh else 2, "", "" if fresh else "System error 1219 has occurred.")
    monkeypatch.setattr(nas, "_WIN", True)
    monkeypatch.setattr(nas, "mount_path", lambda h, s: None)
    monkeypatch.setattr(nas, "_quick_isdir", lambda p, timeout=4.0: False)
    monkeypatch.setattr(nas, "_run", fake_run)
    assert str(nas.connect("TNAS", "public", "robert", "pw")) == str(Path("\\\\TNAS\\public"))
    assert dropped == ["\\\\TNAS\\BACKUPS"]


SMBUTIL_VIEW = """Share                                           Type    Comments
-------------------------------
Music                                           Disk    Projects and stems
Public Share                                    Disk
IPC$                                            Pipe    IPC Service (TNAS)
Home                                            Disk    Home directories
4 shares listed
"""

NET_VIEW = """Shared resources at \\\\TNAS

TerraMaster

Share name  Type  Used as  Comment

-------------------------------------------------------------------------------
Music       Disk           Projects and stems
Public      Disk
The command completed successfully.

"""


def test_mac_share_list_is_read():
    assert nas._table(SMBUTIL_VIEW, True) == [
        {"name": "Music", "comment": "Projects and stems"},
        {"name": "Public Share", "comment": ""},
        {"name": "Home", "comment": "Home directories"},
    ]


def test_windows_share_list_is_read():
    assert nas._table(NET_VIEW, True) == [{"name": "Music", "comment": "Projects and stems"},
                                         {"name": "Public", "comment": ""}]


def test_mac_lists_with_its_own_file_sharing(monkeypatch):
    import subprocess
    seen = []

    def fake_run(args, **kw):
        seen.append(args)
        return subprocess.CompletedProcess(args, 0, SMBUTIL_VIEW, "")
    monkeypatch.setattr(nas, "_MAC", True)
    monkeypatch.setattr(nas, "_run", fake_run)
    assert [x["name"] for x in nas.list_shares("MUSIC-NAS.local", "rob", "p@ss w")] == ["Music", "Public Share", "Home"]
    assert seen[0] == ["smbutil", "view", "//rob:p%40ss%20w@MUSIC-NAS.local"]


def test_mac_wrong_login_says_so(monkeypatch):
    import subprocess
    monkeypatch.setattr(nas, "_MAC", True)
    monkeypatch.setattr(nas, "_run", lambda a, **k: subprocess.CompletedProcess(
        a, 68, "", "smbutil: server rejected the connection: Authentication error"))
    with pytest.raises(nas.NasError, match="name or password"):
        nas.list_shares("MUSIC-NAS.local", "rob", "bad")


def test_typed_folder_that_isnt_shared_names_the_real_ones(monkeypatch):
    import subprocess

    def fake_run(args, **kw):
        if args[0] == "smbutil":
            return subprocess.CompletedProcess(args, 0, SMBUTIL_VIEW, "")
        return subprocess.CompletedProcess(args, 1, "", "error")
    monkeypatch.setattr(nas, "_MAC", True)
    monkeypatch.setattr(nas, "mount_path", lambda h, s: None)
    monkeypatch.setattr(nas, "_run", fake_run)
    with pytest.raises(nas.NasError, match="MUSIC-NAS has no shared folder called LC-AUTOBACKUPS. Its shared folders are Music, Public Share, Home"):
        nas.connect("MUSIC-NAS.local", "LC-AUTOBACKUPS", "rob", "pw")


def test_folder_names_are_made_safe():
    assert nas.folder_name("") == nas.SUBDIR
    assert nas.folder_name("  LC-AUTOBACKUPS ") == "LC-AUTOBACKUPS"
    assert nas.folder_name("a/b:c*?") == "a b c"
    assert nas.folder_name("...") == nas.SUBDIR


def test_music_shares_are_tried_before_photos_and_time_machine():
    shares = [{"name": n, "comment": ""} for n in ("TimeMachine", "Photos", "homes", "Public", "Music", "Backups")]
    assert nas.share_order(shares) == ["Backups", "Music", "Public", "homes", "Photos", "TimeMachine"]


def test_backups_picks_a_shared_folder_it_can_save_into(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from ablebackup.api.app import create_app
    vols = tmp_path / "Volumes"
    monkeypatch.setattr(nas, "list_shares", lambda *a: [{"name": "Photos", "comment": ""}, {"name": "Music", "comment": ""},
                                                       {"name": "Public", "comment": ""}])

    def connect(host, share, user, pw):
        if share == "Music":
            raise nas.NasError("No access")
        (vols / share).mkdir(parents=True, exist_ok=True)
        return vols / share
    monkeypatch.setattr(nas, "connect", connect)
    with TestClient(create_app(token="", db_path=tmp_path / "c.db")) as c:
        r = c.post("/api/nas/connect", json={"host": "music-nas.local", "share": "", "user": "rob", "password": "pw",
                                              "folder": "LC-AUTOBACKUPS", "name": "MUSIC-NAS"}).json()
        assert r["share"] == "Public" and r["folder"] == "LC-AUTOBACKUPS"
        assert (vols / "Public" / "LC-AUTOBACKUPS").is_dir()
        assert c.get("/api/nas").json()["nas"]["share"] == "Public"


def test_only_links_without_a_drive_letter_are_let_go():
    out = "\n".join([
        "New connections will be remembered.",
        "",
        "Status       Local     Remote                    Network",
        "-------------------------------------------------------------------------------",
        "OK                     \\\\100.90.248.35\\BACKUPS   Microsoft Windows Network",
        "Unavailable            \\\\100.90.248.35\\My Music  Microsoft Windows Network",
        "OK           Z:        \\\\100.90.248.35\\public    Microsoft Windows Network",
        "OK                     \\\\other-nas\\BACKUPS       Microsoft Windows Network",
        "                       \\\\100.90.248.35\\IPC$",
        "The command completed successfully.",
    ])
    assert nas.links_to("100.90.248.35", out) == [
        "\\\\100.90.248.35\\BACKUPS", "\\\\100.90.248.35\\My Music", "\\\\100.90.248.35\\IPC$"]
