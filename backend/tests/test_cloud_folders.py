"""Finding Dropbox / Google Drive / iCloud / OneDrive folders for the first-run screen."""
import json

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from ablebackup.service import cloud_folders


def _by_key(found):
    return {f["key"]: f["path"] for f in found}


def test_nothing_installed_lists_every_app_with_no_path(tmp_path):
    found = cloud_folders(home=tmp_path, env={})
    assert [f["label"] for f in found] == ["Dropbox", "Google Drive", "iCloud Drive", "OneDrive"]
    assert all(f["path"] is None for f in found)


def test_finds_default_folders(tmp_path):
    (tmp_path / "Dropbox").mkdir()
    (tmp_path / "Library" / "CloudStorage" / "GoogleDrive-me@x.com" / "My Drive").mkdir(parents=True)
    (tmp_path / "Library" / "Mobile Documents" / "com~apple~CloudDocs").mkdir(parents=True)
    (tmp_path / "Library" / "CloudStorage" / "OneDrive-Personal").mkdir(parents=True)
    got = _by_key(cloud_folders(home=tmp_path, env={}))
    assert got["dropbox"] == str(tmp_path / "Dropbox")
    assert got["gdrive"] == str(tmp_path / "Library" / "CloudStorage" / "GoogleDrive-me@x.com" / "My Drive")
    assert got["icloud"] == str(tmp_path / "Library" / "Mobile Documents" / "com~apple~CloudDocs")
    assert got["onedrive"] == str(tmp_path / "Library" / "CloudStorage" / "OneDrive-Personal")


def test_dropbox_info_json_wins(tmp_path):
    moved = tmp_path / "Volumes" / "Big" / "Dropbox"
    moved.mkdir(parents=True)
    (tmp_path / ".dropbox").mkdir()
    (tmp_path / ".dropbox" / "info.json").write_text(json.dumps({"personal": {"path": str(moved)}}))
    (tmp_path / "Dropbox").mkdir()
    assert _by_key(cloud_folders(home=tmp_path, env={}))["dropbox"] == str(moved)


def test_onedrive_from_windows_env(tmp_path):
    od = tmp_path / "OneDrive - Studio"
    od.mkdir()
    assert _by_key(cloud_folders(home=tmp_path, env={"OneDrive": str(od)}))["onedrive"] == str(od)


def test_api_lists_folders_and_subfolder_name(tmp_path):
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    r = c.get("/api/cloud/folders")
    assert r.status_code == 200
    body = r.json()
    assert body["subdir"] == "Lazy Creatives Backups"
    assert {f["key"] for f in body["folders"]} == {"dropbox", "gdrive", "icloud", "onedrive"}


def test_saving_settings_makes_the_backups_folder_inside_an_existing_one(tmp_path):
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    dropbox = tmp_path / "Dropbox"
    dropbox.mkdir()
    dest = dropbox / "Lazy Creatives Backups"
    c.put("/api/settings", json={"sources": ["X"], "dest": str(dest), "interval_minutes": 0})
    assert dest.is_dir()
    # a missing drive is never created
    gone = tmp_path / "Unplugged" / "Backups"
    c.put("/api/settings", json={"sources": ["X"], "dest": str(gone), "interval_minutes": 0})
    assert not gone.parent.exists()


def test_skipping_backups_saves_with_no_destination(tmp_path):
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    r = c.put("/api/settings", json={"sources": [str(tmp_path)], "dest": "", "interval_minutes": 0})
    assert r.status_code == 200 and r.json()["dest"] == ""
    r = c.post("/api/backup", json={})
    assert r.status_code == 400 and "Settings" in r.json()["detail"]
