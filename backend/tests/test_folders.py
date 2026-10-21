"""Folders: the app's own way to sort projects. A project can sit in several folders;
nothing on the computer moves. One list shared with Uploader and the phone."""
import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from ablebackup.folders import Folders, NotFound
from tests.helpers import fileref_rel, write_als


def _digest(folder: Path):
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob("*")) if p.is_file()}


def test_a_project_can_sit_in_several_folders(tmp_path):
    f = Folders(tmp_path / "folders.db")
    a = f.create("  Finishing   this  month ", ["p1", "p2", "p1"])
    b = f.create("", ["p1"])
    assert a["name"] == "Finishing this month" and sorted(a["project_ids"]) == ["p1", "p2"]
    assert b["name"] == "New folder"
    assert sorted(f.of_project("p1")) == sorted([a["id"], b["id"]])
    f.add(b["id"], ["p3", "p1"])
    assert sorted(f.get(b["id"])["project_ids"]) == ["p1", "p3"]
    f.remove(a["id"], ["p1"])
    assert f.get(a["id"])["project_ids"] == ["p2"]
    assert f.of_project("p1") == [b["id"]]


def test_rename_reorder_delete_and_rev(tmp_path):
    f = Folders(tmp_path / "folders.db")
    r0 = f.rev()
    a, b, c = (f.create(n) for n in ("A", "B", "C"))
    assert f.rev() > r0
    assert f.rename(a["id"], "x" * 300)["name"] == "x" * 80
    assert [x["name"] for x in f.reorder([c["id"], a["id"]])] == ["C", "x" * 80, "B"]
    f.delete(b["id"])
    assert [x["id"] for x in f.all()] == [c["id"], a["id"]]
    with pytest.raises(NotFound):
        f.delete(b["id"])
    with pytest.raises(NotFound):
        f.add(b["id"], ["p1"])


def test_renamed_projects_stay_in_their_folders(tmp_path):
    f = Folders(tmp_path / "folders.db")
    a = f.create("Club", ["old", "other"])
    b = f.create("Chill", ["old", "new"])  # the new id is already there: no double
    f.rename_projects({"old": "new", "gone": "x"})
    assert sorted(f.get(a["id"])["project_ids"]) == ["new", "other"]
    assert f.get(b["id"])["project_ids"] == ["new"]


def test_api_routes(tmp_path):
    app = create_app(token="secret", db_path=tmp_path / "c.db")
    c = TestClient(app)
    assert c.get("/api/folders").status_code in (401, 403)
    c.headers["X-Auth-Token"] = "secret"
    assert c.get("/api/folders").json()["folders"] == []
    made = c.post("/api/folders", json={"name": "Club", "project_ids": ["p1"]}).json()
    fid = made["id"]
    assert c.post(f"/api/folders/{fid}/projects", json={"project_ids": ["p2"]}).json()["project_ids"] == ["p2", "p1"]
    assert c.post(f"/api/folders/{fid}/remove", json={"project_ids": ["p1"]}).json()["project_ids"] == ["p2"]
    assert c.put(f"/api/folders/{fid}", json={"name": "Club 2"}).json()["name"] == "Club 2"
    other = c.post("/api/folders", json={"name": "Chill"}).json()["id"]
    assert [x["id"] for x in c.put("/api/folders/order", json={"folder_ids": [other]}).json()["folders"]] == [other, fid]
    listed = c.get("/api/folders").json()
    assert listed["rev"] == c.get("/api/folders/rev").json()["rev"] > 0
    assert c.delete(f"/api/folders/{fid}").json() == {"ok": True}
    assert c.delete(f"/api/folders/{fid}").status_code == 404
    assert c.post(f"/api/folders/{fid}/projects", json={"project_ids": ["p2"]}).status_code == 404


def test_shared_with_uploader_through_one_file(tmp_path):
    Folders().create("Made in Backups", ["p1"])  # the default place both apps use
    assert [x["name"] for x in Folders(tmp_path / "folders.db").all()] == ["Made in Backups"]


def test_tidy_names_keeps_projects_in_their_folders_and_files_stay_put(tmp_path):
    src = tmp_path / "music"
    proj = src / "glasshouse idea Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loop")
    write_als(proj / "glasshouse idea.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        c.put("/api/settings", json={"sources": [str(src)], "interval_minutes": 0})
        c.post("/api/scan", json={"sources": [str(src)]})
        pid = c.get("/api/library").json()["projects"][0]["project_id"]
        before = _digest(src)
        fid = c.post("/api/folders", json={"name": "Finishing", "project_ids": [pid]}).json()["id"]
        assert _digest(src) == before  # a folder never touches a file
        done = c.post("/api/tidy/apply", json={"project_ids": [pid], "names": {pid: "Glasshouse"}}).json()
        new = done["id_map"][pid]
        assert new != pid
        assert c.get("/api/folders").json()["folders"][0]["project_ids"] == [new]
        c.post("/api/tidy/undo", json={"batch_id": done["batch_id"]})
        assert c.get("/api/folders").json()["folders"][0]["project_ids"] == [pid]
        assert fid


def test_one_folder_reads_the_same_as_in_the_full_list(tmp_path):
    f = Folders(tmp_path / "folders.db")
    for i in range(30):
        f.create(f"Folder {i}", [f"p{i}", f"p{i + 1}"])
    for x in f.all():
        assert f.get(x["id"]) == x
    with pytest.raises(NotFound):
        f.get("nope")
