"""First-run suggestions: the usual project folders that exist here, with counts."""
import time
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup import suggest
from ablebackup.api.app import create_app


def _touch(p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"x")


def _home(tmp_path, monkeypatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    return home


def test_known_places_counted_and_sorted(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    for i in range(3):
        _touch(home / "Music" / "Ableton Projects" / f"Song {i} Project" / f"Song {i}.als")
    for i in range(5):
        _touch(home / "Documents" / "Image-Line" / "FL Studio" / "Projects" / f"beat{i}.flp")
    _touch(home / "Documents" / "REAPER Media" / "mix" / "mix.RPP")  # any case

    out = suggest.suggested_folders()
    assert [d["label"] for d in out] == [
        "Documents / Image-Line / FL Studio / Projects",
        "Music / Ableton Projects",
        "Documents / REAPER Media",
    ]
    assert [d["count"] for d in out] == [5, 3, 1]
    assert out[1]["path"] == str(home / "Music" / "Ableton Projects")


def test_empty_and_missing_folders_are_left_out(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    (home / "Music" / "Ableton Projects").mkdir(parents=True)  # exists, but no projects
    assert suggest.suggested_folders() == []


def test_user_library_and_packs_are_not_projects(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    _touch(home / "Music" / "Ableton" / "User Library" / "Templates" / "Default.als")
    _touch(home / "Music" / "Ableton" / "Factory Packs" / "Drum Booth" / "Demo.als")
    assert suggest.suggested_folders() == []
    _touch(home / "Music" / "Ableton" / "Projects" / "Tune Project" / "Tune.als")
    out = suggest.suggested_folders()
    assert [(d["label"], d["count"]) for d in out] == [("Music / Ableton", 1)]


def test_any_top_level_folder_with_projects_near_the_top(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    _touch(home / "Music" / "Beats" / "2024" / "a.dawproject")       # 2 levels: found
    _touch(home / "Documents" / "Work" / "a" / "b" / "c" / "x.als")  # too deep to notice
    _touch(home / "Music" / "Exports" / "mix.wav")                   # not a project
    out = suggest.suggested_folders()
    assert [(d["label"], d["count"]) for d in out] == [("Music / Beats", 1)]


def test_nested_suggestion_is_folded_into_its_parent(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    _touch(home / "Documents" / "FL Studio" / "Projects" / "a.flp")
    _touch(home / "Documents" / "FL Studio" / "b.flp")
    out = suggest.suggested_folders()
    assert [(d["label"], d["count"]) for d in out] == [("Documents / FL Studio", 2)]


def test_counting_is_depth_capped(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    root = home / "Music" / "Ableton Projects"
    _touch(root / "a" / "a.als")
    _touch(root / "1" / "2" / "3" / "4" / "5" / "deep.als")
    out = suggest.suggested_folders()
    assert out[0]["count"] == 1


def test_time_budget_is_respected(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    for i in range(30):
        _touch(home / "Music" / "Ableton Projects" / f"p{i}" / f"p{i}.als")
    t = time.monotonic()
    out = suggest.suggested_folders(budget=0.0)
    assert time.monotonic() - t < 1.0
    assert all(d["count"] > 0 for d in out)   # partial at most, never junk


def test_endpoint(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    _touch(home / "Documents" / "Bitwig Studio" / "Projects" / "s" / "s.dawproject")
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    r = c.get("/api/setup/suggested-folders")
    assert r.status_code == 200
    assert r.json() == [{"path": str(home / "Documents" / "Bitwig Studio" / "Projects"),
                         "label": "Documents / Bitwig Studio / Projects", "count": 1}]


def test_logic_packages_count_as_projects(tmp_path, monkeypatch):
    home = _home(tmp_path, monkeypatch)
    for i in range(2):  # a .logicx project is a folder full of files; count it once
        _touch(home / "Music" / "Logic" / f"Tune {i}.logicx" / "Alternatives" / "000" / "ProjectData")
    out = suggest.suggested_folders()
    assert [(d["label"], d["count"]) for d in out] == [("Music / Logic", 2)]
