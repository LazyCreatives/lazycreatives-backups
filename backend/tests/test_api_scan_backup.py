import time
from pathlib import Path
from fastapi.testclient import TestClient
from ablebackup.api.app import create_app
from tests.helpers import write_als, fileref_rel, fileref_abs


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


def test_backup_merges_saved_and_oneoff_libraries(tmp_path, monkeypatch):
    """A per-run `libraries` hint ("look in this folder") is merged with the saved
    sample libraries — deduped, saved-first — and handed to the backup engine."""
    src = tmp_path / "music"
    src.mkdir()
    _build_project(src)
    dest = tmp_path / "NAS"

    captured = {}

    def fake_run_backup(sources, dst, cat, timestamp, progress, als_paths, label,
                        portable, layout, find_missing, libraries, should_cancel,
                        mirrors, relink_map=None):
        captured["libraries"] = list(libraries)
        return {"ok_count": 0, "error_count": 0, "results": []}

    monkeypatch.setattr("ablebackup.api.app.run_backup", fake_run_backup)

    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        c.put("/api/settings", json={"sources": [str(src)], "dest": str(dest),
                                     "interval_minutes": 0, "libraries": ["/saved/lib"]})
        r = c.post("/api/backup", json={
            "sources": [str(src)], "dest": str(dest), "timestamp": "2026-06-06_1600",
            "find_missing": True,
            # one dup of the saved lib (must collapse) + one genuinely new hint
            "libraries": ["/saved/lib", "/Volumes/SSD/where I think they are"],
        })
        assert r.status_code == 200
        job_id = r.json()["job_id"]
        for _ in range(100):
            if c.get(f"/api/jobs/{job_id}").json()["state"] == "done":
                break
            time.sleep(0.05)

    assert captured["libraries"] == ["/saved/lib", "/Volumes/SSD/where I think they are"]


def test_project_missing_endpoint_lists_every_missing_sample(tmp_path):
    """The trust view: GET /api/project/missing returns the complete, live list of a
    project's missing samples (name + the path it expects), not just a count."""
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "kick.wav").write_bytes(b"present")
    als = proj / "Song.als"
    write_als(als, [
        fileref_abs("/gone/away/lead_synth.wav", "lead_synth.wav"),  # missing
        fileref_abs("/gone/away/vox_chop.wav", "vox_chop.wav"),      # missing
        fileref_rel("Samples/kick.wav", "kick.wav"),                 # present
    ])
    c = _client(tmp_path)
    r = c.get("/api/project/missing", params={"path": str(als)})
    assert r.status_code == 200
    body = r.json()
    assert body["present_count"] == 1
    assert body["missing_count"] == 2
    names = sorted(m["name"] for m in body["missing"])
    assert names == ["lead_synth.wav", "vox_chop.wav"]
    # the expected path is exposed so the user can SEE where it was looking
    assert all(m["expected_path"] for m in body["missing"])


def test_project_missing_endpoint_rejects_unknown_path(tmp_path):
    c = _client(tmp_path)
    assert c.get("/api/project/missing", params={"path": str(tmp_path / "nope.als")}).status_code == 404


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


def test_point_to_file_is_remembered(tmp_path, monkeypatch):
    """A file pointed at for a missing sample still holds after leaving the page:
    the missing list shows it as chosen (not missing), and a later backup of the
    project (with no pick sent) still uses that file."""
    monkeypatch.setenv("ABLEBACKUP_FREE_BETA", "1")  # every feature on, as shipped
    proj = tmp_path / "Song Project"
    proj.mkdir()
    als = proj / "Song.als"
    write_als(als, [
        fileref_abs("/gone/away/lead_synth.wav", "lead_synth.wav"),
        fileref_abs("/gone/away/vox_chop.wav", "vox_chop.wav"),
    ])
    chosen = tmp_path / "found" / "lead_synth.wav"
    chosen.parent.mkdir()
    chosen.write_bytes(b"the real lead")
    dest = tmp_path / "NAS"

    def wait(c, job_id):
        for _ in range(200):
            st = c.get(f"/api/jobs/{job_id}").json()
            if st["state"] != "running":
                return st
            time.sleep(0.05)
        return st

    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        c.put("/api/settings", json={"sources": [str(tmp_path)], "dest": str(dest),
                                     "interval_minutes": 0})
        before = c.get("/api/project/missing", params={"path": str(als)}).json()
        expected = next(m["expected_path"] for m in before["missing"] if m["name"] == "lead_synth.wav")
        r = c.post("/api/backup", json={
            "als_paths": [str(als)], "find_missing": True, "timestamp": "2026-10-06_1800",
            "relink_map": {expected: str(chosen)}})
        assert wait(c, r.json()["job_id"])["state"] == "done"

        # Leaving the page and coming back: the pick is still there.
        again = c.get("/api/project/missing", params={"path": str(als)}).json()
        by_name = {m["name"]: m for m in again["missing"]}
        assert by_name["lead_synth.wav"]["pointed"] == str(chosen)
        assert by_name["vox_chop.wav"]["pointed"] is None
        assert again["missing_count"] == 1

        # A later backup, sent without any pick (like the scheduled one), keeps it.
        # (Portable this time, so it isn't skipped as identical to the first.)
        r = c.post("/api/backup", json={
            "als_paths": [str(als)], "find_missing": True, "portable": True,
            "timestamp": "2026-10-06_1900"})
        st = wait(c, r.json()["job_id"])
    assert st["state"] == "done"
    copies = list(dest.rglob("lead_synth.wav"))
    assert any("2026-10-06_1900" in str(p) for p in copies)
