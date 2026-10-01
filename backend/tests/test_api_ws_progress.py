from pathlib import Path
from fastapi.testclient import TestClient
from ablebackup.api.app import create_app
from tests.helpers import write_als, fileref_rel


def _build_project(root: Path):
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def test_ws_streams_backup_progress(tmp_path):
    src = tmp_path / "music"
    src.mkdir()
    _build_project(src)
    dest = tmp_path / "NAS"
    app = create_app(token="", db_path=tmp_path / "c.db")
    client = TestClient(app)

    with client.websocket_connect("/ws/progress") as ws:
        client.post("/api/backup", json={"sources": [str(src)], "dest": str(dest),
                                         "timestamp": "2026-06-06_1430"})
        seen = []
        for _ in range(50):
            ev = ws.receive_json()
            seen.append(ev["type"])
            if ev["type"] == "backup_done":
                break
    assert "backup_start" in seen
    assert "project_done" in seen
    assert seen[-1] == "backup_done"


def test_ws_rejects_bad_token(tmp_path):
    app = create_app(token="secret", db_path=tmp_path / "c.db")
    client = TestClient(app)
    import pytest
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/progress?token=wrong") as ws:
            ws.receive_json()
