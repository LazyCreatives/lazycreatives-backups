"""The Library says which projects sit inside the folders from Settings, so Home's
"Back up N projects" counts exactly what the button backs up."""
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from tests.helpers import fileref_rel, write_als


def _project(root: Path) -> None:
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def test_library_marks_projects_inside_the_settings_folders(tmp_path):
    """Home's "Back up N projects" counts only these (pick 8)."""
    inside = tmp_path / "music"
    outside = tmp_path / "elsewhere"
    for d in (inside, outside):
        d.mkdir()
        _project(d)
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        c.put("/api/settings", json={"sources": [str(inside)], "dest": "", "interval_minutes": 0})
        c.post("/api/scan", json={"sources": [str(inside), str(outside)]})
        rows = c.get("/api/library").json()["projects"]
    flags = sorted((Path(r["path"]).parent.parent.name, r["in_folders"]) for r in rows)
    assert flags == [("elsewhere", False), ("music", True)]
