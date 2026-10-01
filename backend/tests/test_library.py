"""Persistent library: discovered-project catalog, owner tagging, scan scopes,
the /api/library endpoint, skipped-dir visibility, and elevated discovery."""
import os
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog
from ablebackup.scanner import find_projects_progress
from ablebackup.service import owner_for_path, resolve_scan_roots
from tests.helpers import write_als


def test_owner_for_path():
    assert owner_for_path("/Users/bob/Music/Track/Track.als") == "bob"
    assert owner_for_path("/Volumes/BigDrive/Beats/x.als") == "BigDrive"
    assert owner_for_path("/Users/Shared/x.als") == "system"
    assert owner_for_path("/tmp/loose.als") == "system"


def test_resolve_scan_roots():
    configured = [Path("/some/source")]
    assert resolve_scan_roots("sources", configured) == configured
    assert resolve_scan_roots(None, configured) == configured
    home = Path.home()
    assert resolve_scan_roots("home", configured) == [home]      # per-account: only own home
    assert home in resolve_scan_roots("volumes", configured)     # home + mounted volumes


def test_discovered_library_backed_up_status(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    cat.upsert_discovered([
        {"project_id": "aaa", "name": "Anthem", "path": "/Users/bob/Anthem/Anthem.als",
         "dir": "/Users/bob/Anthem", "daw": "ableton", "owner": "bob",
         "size": 1000, "mtime": 1.0, "missing_count": 0},
        {"project_id": "bbb", "name": "Demo", "path": "/Volumes/Drive/Demo/Demo.als",
         "dir": "/Volumes/Drive/Demo", "daw": "ableton", "owner": "Drive",
         "size": 2000, "mtime": 2.0, "missing_count": 1},
    ], "2026-06-09-1000")

    lib = {r["name"]: r for r in cat.library()}
    assert lib["Anthem"]["backed_up"] is False
    assert lib["Demo"]["backed_up"] is False

    # Back up "Anthem" (matched by project_id) -> now flagged backed up
    cat.record_snapshot("Anthem", "2026-06-09-1100", 1000, 5, "ok", [], project_id="aaa")
    lib = {r["name"]: r for r in cat.library()}
    assert lib["Anthem"]["backed_up"] is True
    assert lib["Anthem"]["snapshot_count"] == 1
    assert lib["Demo"]["backed_up"] is False

    # Re-scan refreshes (no duplicate row) — still 2 projects
    cat.upsert_discovered([
        {"project_id": "aaa", "name": "Anthem", "path": "/Users/bob/Anthem/Anthem.als",
         "dir": "/Users/bob/Anthem", "daw": "ableton", "owner": "bob",
         "size": 1234, "mtime": 9.0, "missing_count": 0},
    ], "2026-06-09-1200")
    rows = cat.library()
    assert len(rows) == 2
    assert {r["name"]: r["size"] for r in rows}["Anthem"] == 1234


def test_api_library_endpoint(tmp_path):
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    cat = c.app.state.catalog
    cat.upsert_discovered([
        {"project_id": "p1", "name": "A", "path": "/Users/ann/A/A.als", "dir": "/Users/ann/A",
         "daw": "ableton", "owner": "ann", "size": 1, "mtime": 1.0, "missing_count": 0},
        {"project_id": "p2", "name": "B", "path": "/Users/ben/B/B.als", "dir": "/Users/ben/B",
         "daw": "ableton", "owner": "ben", "size": 1, "mtime": 1.0, "missing_count": 0},
    ], "2026-06-09-1000")
    r = c.get("/api/library")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert body["owners"] == ["ann", "ben"]      # grouped/sorted by user
    assert {p["name"] for p in body["projects"]} == {"A", "B"}


def test_unreadable_dirs_are_counted_not_swallowed(tmp_path):
    # A readable project is still found; an unreadable sibling is COUNTED, not raised.
    good = tmp_path / "good"; good.mkdir()
    write_als(good / "X.als", [])
    locked = tmp_path / "locked"; locked.mkdir()
    (locked / "inner").mkdir()
    os.chmod(locked, 0o000)
    try:
        stats: dict = {}
        files = find_projects_progress([tmp_path], stats=stats)
        assert any(f.name == "X.als" for f in files)
        assert stats["skipped_dirs"] >= 1
    finally:
        os.chmod(locked, 0o755)  # so pytest can clean tmp_path up


