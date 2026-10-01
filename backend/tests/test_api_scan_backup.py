import time
from pathlib import Path
from fastapi.testclient import TestClient
from ablebackup.api.app import create_app
from tests.helpers import write_als, fileref_rel


def _build_project(root: Path):
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def _build_named(root: Path, name: str) -> Path:
    proj = root / f"{name} Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    als = proj / f"{name}.als"
    write_als(als, [fileref_rel("Samples/loop.wav", "loop.wav")])
    return als


def _client(tmp_path):
    app = create_app(token="", db_path=tmp_path / "c.db")
    return TestClient(app)


def test_scan_endpoint_returns_projects(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _build_project(src)
    c = _client(tmp_path)
    r = c.post("/api/scan", json={"sources": [str(src)]})
    assert r.status_code == 200
    projects = r.json()["projects"]
    assert len(projects) == 1
    assert projects[0]["name"] == "Song"
    assert projects[0]["present_count"] == 1


def test_scan_uses_saved_config_when_sources_omitted(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _build_project(src)
    c = _client(tmp_path)
    c.put("/api/settings", json={"sources": [str(src)], "dest": "", "interval_minutes": 0})
    r = c.post("/api/scan", json={})
    assert r.status_code == 200
    assert len(r.json()["projects"]) == 1


def test_backup_endpoint_runs_job_to_completion(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _build_project(src)
    dest = tmp_path / "NAS"
    app = create_app(token="", db_path=tmp_path / "c.db")
    # `with` keeps one persistent event loop (like uvicorn) so the background
    # task created in the POST survives across the polling requests.
    with TestClient(app) as c:
        r = c.post("/api/backup", json={"sources": [str(src)], "dest": str(dest),
                                        "timestamp": "2026-06-06_1430"})
        assert r.status_code == 200
        job_id = r.json()["job_id"]

        status = {"state": "running"}
        for _ in range(100):
            status = c.get(f"/api/jobs/{job_id}").json()
            if status["state"] == "done":
                break
            time.sleep(0.05)
    assert status["state"] == "done"
    assert status["result"]["ok_count"] == 1
    snap = dest / "AbletonBackups" / "projects" / "Song" / "2026-06-06_1430" / "Song.als"
    assert snap.exists()


def test_verify_endpoint_confirms_snapshot(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _build_project(src)
    dest = tmp_path / "NAS"
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        r = c.post("/api/backup", json={"sources": [str(src)], "dest": str(dest),
                                        "timestamp": "2026-06-06_1430"})
        job = r.json()["job_id"]
        for _ in range(100):
            if c.get(f"/api/jobs/{job}").json()["state"] == "done":
                break
            time.sleep(0.05)
        snaps = c.get("/api/projects/Song").json()["snapshots"]
        assert snaps[0]["verified"] == 1  # post-backup light verify passed
        v = c.get(f"/api/verify/{snaps[0]['id']}").json()
    assert v["ok"] is True
    assert v["present"] == v["checked"] >= 2


def test_backup_only_selected_als_paths(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    keep = _build_named(src, "Keep")
    _build_named(src, "Skip")
    dest = tmp_path / "NAS"
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        r = c.post("/api/backup", json={
            "sources": [str(src)], "dest": str(dest),
            "timestamp": "2026-06-06_1500", "als_paths": [str(keep)],
        })
        job_id = r.json()["job_id"]
        status = {"state": "running"}
        for _ in range(100):
            status = c.get(f"/api/jobs/{job_id}").json()
            if status["state"] == "done":
                break
            time.sleep(0.05)
    assert status["result"]["ok_count"] == 1
    assert (dest / "AbletonBackups" / "projects" / "Keep" / "2026-06-06_1500").exists()
    assert not (dest / "AbletonBackups" / "projects" / "Skip" / "2026-06-06_1500").exists()
