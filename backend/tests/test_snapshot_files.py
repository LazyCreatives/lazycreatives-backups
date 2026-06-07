import json

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app


def test_snapshot_files_lists_manifest(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")
    cat = app.state.catalog
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "manifest.json").write_text(json.dumps({
        "portable": True,
        "files": [
            {"logical_path": "Song.als", "size": 10, "inside_project": True, "relinked": False, "source_path": "/x/Song.als"},
            {"logical_path": "_External/kick.wav", "size": 20, "inside_project": False, "relinked": True, "source_path": "/splice/kick.wav"},
        ],
    }))
    cat.record_snapshot("Song", "2026-06-06_1200", 30, 2, "ok", [], dir=str(snap))
    sid = cat.snapshots_for("Song")[0]["id"]

    r = TestClient(app).get(f"/api/snapshot/{sid}/files").json()
    assert r["manifest_present"] is True
    assert r["portable"] is True
    assert len(r["files"]) == 2
    gathered = [f for f in r["files"] if not f["inside_project"]]
    assert gathered[0]["logical_path"] == "_External/kick.wav"
    assert gathered[0]["relinked"] is True


def test_snapshot_files_missing_manifest_is_graceful(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")
    cat = app.state.catalog
    cat.record_snapshot("Old", "2026-06-01_1000", 5, 1, "ok", ["lost.wav"], dir=str(tmp_path / "nope"))
    sid = cat.snapshots_for("Old")[0]["id"]
    r = TestClient(app).get(f"/api/snapshot/{sid}/files").json()
    assert r["manifest_present"] is False
    assert r["files"] == []
