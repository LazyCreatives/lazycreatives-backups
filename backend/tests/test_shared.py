"""Sharing albums, Folders and project folders with another computer through the
backup place. Two computers are two sets of records pointed at one shared folder."""
import json
import os
import time

from fastapi.testclient import TestClient

from ablebackup import shared
from ablebackup.albums import Albums, file_checks
from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog
from ablebackup.folders import Folders
from ablebackup.scanner import project_id


class Computer:
    def __init__(self, root, nas):
        self.root = root
        self.music = root / "Music"
        (self.music / "Night Drive").mkdir(parents=True)
        (self.music / "Night Drive" / "Night Drive.als").write_bytes(b"als")
        (self.music / "Night Drive" / "Night Drive master.wav").write_bytes(b"x" * 1000)
        (self.music / "Glass").mkdir()
        (self.music / "Glass" / "Glass.wav").write_bytes(b"y" * 2000)
        self.catalog = Catalog(root / "backups.db")
        self.catalog.set_setting("config", {"sources": [str(self.music)], "dest": str(nas)})
        als = self.music / "Night Drive" / "Night Drive.als"
        self.pid = project_id(als)
        self.catalog.upsert_discovered([{
            "project_id": self.pid, "name": "Night Drive", "path": str(als), "dir": str(als.parent),
            "daw": "ableton", "owner": "", "size": 3, "mtime": 0, "missing_count": 0}], "now")
        self.albums = Albums(root / "albums.db")
        self.folders = Folders(root / "folders.db")
        self.sharing = shared.Sharing(self.catalog, self.albums, self.folders)
        self.sharing.catalog.set_setting(shared.SETTING, {"on": True, "me": root.name})

    def song(self, *rel):
        return str(self.music.joinpath(*rel))


def _pair(tmp_path):
    nas = tmp_path / "nas"
    nas.mkdir()
    return Computer(tmp_path / "studio", nas), Computer(tmp_path / "laptop", nas), nas


def test_an_album_made_on_one_computer_shows_on_the_other_with_its_own_songs(tmp_path):
    a, b, nas = _pair(tmp_path)
    al = a.albums.create("Night Moves", "2026-11-01")
    a.albums.add_songs(al["id"], [{"path": a.song("Night Drive", "Night Drive master.wav")},
                                  {"path": a.song("Glass", "Glass.wav")}])
    a.albums.set_song(al["id"], a.song("Glass", "Glass.wav"), title="Glasshouse", gapless_after=True)
    a.sharing.share_now()
    assert (nas / shared.DIR_NAME / "studio.json").is_file()

    # both computers are on this one test machine: hide the studio's copies from the laptop
    for p in (a.music / "Night Drive" / "Night Drive master.wav", a.music / "Glass" / "Glass.wav"):
        p.rename(p.with_suffix(".hidden"))
    b.sharing.share_now()
    got = b.albums.get(al["id"])
    assert got["title"] == "Night Moves" and got["release_date"] == "2026-11-01"
    # the same files, found where this computer keeps them
    assert [s["path"] for s in got["songs"]] == [b.song("Night Drive", "Night Drive master.wav"),
                                                 b.song("Glass", "Glass.wav")]
    assert got["songs"][1]["title"] == "Glasshouse" and got["songs"][1]["gapless_after"] is True

    # nothing changed, so nothing bounces back and forth
    stamp = a.albums.get(al["id"])["updated_at"]
    a.sharing.share_now()
    assert a.albums.get(al["id"])["updated_at"] == stamp
    assert [s["path"] for s in a.albums.get(al["id"])["songs"]][0] == a.song("Night Drive", "Night Drive master.wav")


def test_a_song_the_other_computer_hasnt_got_stays_and_says_so(tmp_path):
    a, b, _ = _pair(tmp_path)
    only = a.root / "Elsewhere" / "Bonus.wav"
    only.parent.mkdir()
    only.write_bytes(b"z" * 10)
    al = a.albums.create("EP")
    a.albums.add_songs(al["id"], [{"path": str(only)}])
    a.sharing.share_now()
    b.sharing.share_now()
    song = b.albums.get(al["id"])["songs"][0]
    assert song["path"] == str(only)
    # this test runs on one computer, so pretend the studio's folders aren't here
    assert file_checks({"path": "/Users/someone-else/Music/Bonus.wav", "title": "Bonus"}) == ["Not on this computer"]
    assert file_checks({"path": str(tmp_path / "gone.wav"), "title": "Gone"}) == ["File moved or deleted"]


def test_newest_change_wins_and_a_deletion_travels(tmp_path):
    a, b, _ = _pair(tmp_path)
    al = a.albums.create("First")
    a.sharing.share_now()
    b.sharing.share_now()
    time.sleep(0.01)
    b.albums.update(al["id"], title="Renamed on laptop")
    b.sharing.share_now()
    a.sharing.share_now()
    assert a.albums.get(al["id"])["title"] == "Renamed on laptop"

    a.albums.delete(al["id"])
    a.sharing.share_now()
    b.sharing.share_now()
    assert b.albums.all() == []
    # and it doesn't come back from the old file
    a.sharing.share_now()
    assert a.albums.all() == []


def test_folders_follow_the_project_to_its_place_on_the_other_computer(tmp_path):
    a, b, _ = _pair(tmp_path)
    f = a.folders.create("Finish this month", [a.pid])
    a.sharing.share_now()
    b.sharing.share_now()
    got = b.folders.get(f["id"])
    assert got["name"] == "Finish this month" and got["project_ids"] == [b.pid]
    b.folders.rename(f["id"], "Finish in November")
    b.sharing.share_now()
    a.sharing.share_now()
    assert a.folders.get(f["id"])["name"] == "Finish in November"
    assert a.folders.get(f["id"])["project_ids"] == [a.pid]


def test_project_folders_join_only_when_theyre_there(tmp_path):
    a, b, _ = _pair(tmp_path)
    extra = a.root / "Collabs"
    extra.mkdir()
    cfg = a.catalog.get_setting("config")
    a.catalog.set_setting("config", {**cfg, "sources": cfg["sources"] + [str(extra), "/no/such/folder"]})
    a.sharing.share_now()
    b.sharing.share_now()
    srcs = b.catalog.get_setting("config")["sources"]
    assert str(extra) in srcs           # reachable from here (a shared drive)
    assert "/no/such/folder" not in srcs
    assert str(b.music) in srcs          # its own stay

    # taken away on one computer, taken away on the other
    a.catalog.set_setting("config", {**a.catalog.get_setting("config"), "sources": [str(a.music)]})
    a.sharing.share_now()
    b.sharing.share_now()
    assert str(extra) not in b.catalog.get_setting("config")["sources"]


def test_a_nas_folder_is_found_where_this_computer_connects_it(tmp_path):
    a, b, _ = _pair(tmp_path)
    mount_a, mount_b = tmp_path / "Volumes" / "music", tmp_path / "Z"
    (mount_a / "Projects").mkdir(parents=True)
    (mount_b / "Projects").mkdir(parents=True)
    for c, m in ((a, mount_a), (b, mount_b)):
        c.catalog.set_setting("nas", {"host": "tnas", "share": "backups", "path": str(tmp_path / "nas"),
                                      "shares": {"music": str(m)}})
    cfg = a.catalog.get_setting("config")
    a.catalog.set_setting("config", {**cfg, "sources": cfg["sources"] + [str(mount_a / "Projects")]})
    a.sharing.share_now()
    b.sharing.share_now()
    assert str(mount_b / "Projects") in b.catalog.get_setting("config")["sources"]
    assert str(mount_a / "Projects") not in b.catalog.get_setting("config")["sources"]


def test_off_by_default_and_never_touches_project_files(tmp_path):
    a, b, nas = _pair(tmp_path)
    before = {p: p.read_bytes() for p in a.root.rglob("*") if p.is_file() and p.suffix in (".als", ".wav")}
    a.sharing.catalog.set_setting(shared.SETTING, {"me": "studio"})
    assert a.sharing.on is False
    a.albums.create("Private")
    a.sharing.share_now()
    assert not (nas / shared.DIR_NAME).exists()
    a.sharing.switch(True)
    a.sharing.share_now()
    assert (nas / shared.DIR_NAME / "studio.json").is_file()
    assert {p: p.read_bytes() for p in before} == before


def test_a_broken_file_from_another_computer_is_skipped(tmp_path):
    a, b, nas = _pair(tmp_path)
    (nas / shared.DIR_NAME).mkdir()
    (nas / shared.DIR_NAME / "half.json").write_text("{not json")
    (nas / shared.DIR_NAME / "other.json").write_text(json.dumps({"v": 99}))
    a.albums.create("Still fine")
    assert a.sharing.share_now()["error"] == ""


def test_an_unplugged_backup_place_waits(tmp_path):
    a, _, nas = _pair(tmp_path)
    a.catalog.set_setting("config", {**a.catalog.get_setting("config"), "dest": str(tmp_path / "gone" / "nas")})
    st = a.sharing.share_now()
    assert "isn't connected" in st["waiting"] and not st.get("error")


def test_the_settings_switch(tmp_path, monkeypatch):
    monkeypatch.setenv("LC_ALBUMS_DB", str(tmp_path / "albums.db"))
    nas = tmp_path / "nas"
    nas.mkdir()
    app = create_app("t", tmp_path / "backups.db")
    with TestClient(app) as c:
        h = {"X-Auth-Token": "t"}
        assert c.get("/api/shared", headers=h).json()["on"] is False
        c.put("/api/settings", headers=h, json={"sources": [], "dest": str(nas)})
        st = c.put("/api/shared", headers=h, json={"on": True}).json()
        assert st["on"] is True and st["place"] == os.path.join(str(nas), shared.DIR_NAME)
        st = c.post("/api/shared/now", headers=h).json()
        assert st["error"] == "" and (nas / shared.DIR_NAME).is_dir()
        assert c.put("/api/shared", headers=h, json={"on": False}).json()["on"] is False
