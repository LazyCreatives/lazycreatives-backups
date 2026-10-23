"""Sorting backups into the producer's own folders, and moving old copies to match."""
import os
from pathlib import Path

from ablebackup.catalog import Catalog
from ablebackup.daws.base import _keep_dirs
from ablebackup.scanner import scan_projects
from ablebackup.service import run_backup
from ablebackup.sorting import (apply_sort, clean_levels, get_sort, level_folders, plan_moves,
                                preview, project_folder_name, safe_folder, undo_sort)
from tests.helpers import fileref_rel, write_als

MADE = 1_760_000_000  # 9 Oct 2025


def _project(root: Path, folder: str, name: str, sample: bytes = b"loop") -> Path:
    proj = root / folder / f"{name} Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(sample)
    als = write_als(proj / f"{name}.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    os.utime(als, (MADE, MADE))
    return als


def _found(cat: Catalog, src: Path, genre: str | None = None):
    rows = []
    for p in scan_projects([src]):
        rows.append({"project_id": p.project_id, "name": p.name, "path": str(p.project_path),
                     "dir": str(p.project_dir), "daw": p.daw_id, "owner": "me", "size": 1,
                     "mtime": p.mtime, "missing_count": 0, "genre": genre})
    cat.upsert_discovered(rows, "2026-10-22")


def test_levels_are_cleaned():
    assert clean_levels(None) == ["program"]
    assert clean_levels([]) == ["program"]
    assert clean_levels(["year", "year", "nonsense", "genre", "month", "folder"]) == ["year", "genre", "month"]


def test_folder_names_any_computer_accepts():
    assert safe_folder("Hip-Hop/Rap", "x") == "Hip-Hop Rap"
    assert safe_folder("CON", "x") == "x"
    assert safe_folder("trailing dot. ", "x") == "trailing dot"
    assert safe_folder("", "x") == "x"
    assert len(safe_folder("a" * 300, "x")) == 80


def test_project_folder_is_the_one_around_its_own_folder(tmp_path):
    assert project_folder_name(tmp_path / "Album ideas" / "Night Drive Project", "Night Drive") == "Album ideas"
    assert project_folder_name(tmp_path / "FL Projects", "Night Drive") == "FL Projects"
    assert project_folder_name(None, "x") == "Other projects"


def test_month_carries_its_year_when_on_its_own():
    with_year = level_folders(["year", "month"], daw="ableton", made=MADE, genre=None, folder=None)
    alone = level_folders(["month", "genre"], daw="ableton", made=MADE, genre=None, folder=None)
    assert with_year == ["2025", "10 October"]
    assert alone == ["2025-10 October", "No genre"]


def test_default_sort_keeps_the_old_folders(tmp_path):
    src = tmp_path / "src"
    _project(src, "Album ideas", "Night Drive")
    cat = Catalog(tmp_path / "c.db")
    run_backup([src], tmp_path / "NAS", cat, timestamp="2026-10-22_0900")
    assert (tmp_path / "NAS" / "AbletonBackups" / "projects" / "Night Drive" / "2026-10-22_0900"
            / "Night Drive.als").exists()
    assert not (tmp_path / "NAS" / ".pool").exists()


def test_backups_follow_the_chosen_sort(tmp_path):
    src = tmp_path / "src"
    _project(src, "Album ideas", "Night Drive")
    cat = Catalog(tmp_path / "c.db")
    _found(cat, src, genre="House")
    nas = tmp_path / "NAS"
    nas.mkdir()
    apply_sort(cat, nas, ["year", "genre", "folder"])
    run_backup([src], nas, cat, timestamp="2026-10-22_0900")
    snap = nas / "2025" / "House" / "Album ideas" / "Night Drive" / "2026-10-22_0900"
    assert (snap / "Night Drive.als").exists()
    assert (nas / ".pool").is_dir()
    assert cat.snapshots_for("Night Drive")[0]["dir"] == str(snap)
    # a scan of the drive never mistakes a backup copy for a project
    assert scan_projects([nas]) == []


def test_old_backups_move_to_match_and_undo_puts_them_back(tmp_path):
    src = tmp_path / "src"
    _project(src, "Album ideas", "Night Drive", b"one")
    _project(src, "Beats", "Low Sun", b"two")
    cat = Catalog(tmp_path / "c.db")
    _found(cat, src, genre="Drum & Bass")
    nas = tmp_path / "NAS"
    run_backup([src], nas, cat, timestamp="2026-10-20_0900")
    old = nas / "AbletonBackups" / "projects" / "Night Drive" / "2026-10-20_0900"
    assert old.is_dir()
    before = sorted(p.name for p in nas.iterdir())

    assert preview(cat, nas, ["program", "year"])["moves"] == 2
    r = apply_sort(cat, nas, ["program", "year"])
    assert r["moved"] == 2 and r["failed"] == 0
    new = nas / "Ableton" / "2025" / "Night Drive" / "2026-10-20_0900"
    assert (new / "Night Drive.als").exists()
    assert not old.exists()
    assert not (nas / "AbletonBackups").exists()  # nothing left behind but the moved copies
    assert cat.snapshots_for("Night Drive")[0]["dir"] == str(new)
    assert get_sort(cat) == ["program", "year"]
    # nothing moves twice
    assert plan_moves(cat, nas, ["program", "year"]) == []

    u = undo_sort(cat)
    assert u["moved"] == 2
    assert (old / "Night Drive.als").exists()
    assert not (nas / "Ableton").exists()
    assert get_sort(cat) == ["program"]
    assert sorted(p.name for p in nas.iterdir()) == sorted(before + [".pool"])
    assert cat.snapshots_for("Night Drive")[0]["dir"] == str(old)


def test_unchanged_project_is_not_backed_up_again_after_a_sort_change(tmp_path):
    src = tmp_path / "src"
    _project(src, "Album ideas", "Night Drive")
    cat = Catalog(tmp_path / "c.db")
    nas = tmp_path / "NAS"
    run_backup([src], nas, cat, timestamp="2026-10-20_0900")
    apply_sort(cat, nas, ["folder"])
    s = run_backup([src], nas, cat, timestamp="2026-10-22_0900")
    assert s["skipped_count"] == 1


def test_space_saving_keeps_working_across_the_move(tmp_path):
    src = tmp_path / "src"
    als = _project(src, "Album ideas", "Night Drive", b"same-loop")
    cat = Catalog(tmp_path / "c.db")
    nas = tmp_path / "NAS"
    _found(cat, src)
    run_backup([src], nas, cat, timestamp="2026-10-20_0900")
    apply_sort(cat, nas, ["year"])
    write_als(als, [fileref_rel("Samples/loop.wav", "loop.wav")] * 2)  # a new save, this year
    run_backup([src], nas, cat, timestamp="2026-10-22_0900")
    a = nas / "2025" / "Night Drive" / "2026-10-20_0900" / "Samples" / "loop.wav"
    b = nas / "2025" / "Night Drive" / "2026-10-22_0900" / "Samples" / "loop.wav"
    assert a.stat().st_ino == b.stat().st_ino  # one copy on the drive, linked twice


def test_two_projects_with_one_name_keep_their_own_folders(tmp_path):
    src = tmp_path / "src"
    _project(src / "a", "Album ideas", "Song", b"alpha")
    _project(src / "b", "Album ideas", "Song", b"beta")
    cat = Catalog(tmp_path / "c.db")
    nas = tmp_path / "NAS"
    run_backup([src], nas, cat, timestamp="2026-10-20_0900")
    apply_sort(cat, nas, ["folder"])
    folders = sorted(p.name for p in (nas / "Album ideas").iterdir())
    assert len(folders) == 2 and folders[0] == "Song"


def test_scans_skip_backup_copies_wherever_they_sit():
    assert _keep_dirs(["2026-10-22_0900", "2026", "House"], set()) == ["2026", "House"]


def test_sort_api(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from ablebackup.api.app import create_app
    src = tmp_path / "src"
    _project(src, "Album ideas", "Low Sun")
    nas = tmp_path / "NAS"
    app = create_app(db_path=tmp_path / "c.db", token="")
    with TestClient(app) as c:
        h = {}
        assert c.put("/api/settings", json={"sources": [str(src)], "dest": str(nas)}, headers=h).status_code == 200
        run_backup([src], nas, app.state.catalog, timestamp="2026-10-20_0900")
        r = c.get("/api/backup-sort", headers=h).json()
        assert r["levels"] == ["program"] and r["undo"] is False
        p = c.post("/api/backup-sort/preview", json={"levels": ["year", "folder"]}, headers=h).json()
        assert p["example"][-2:] == ["Low Sun", "2026-10-20_0900"] and p["moves"] == 1
        assert p["move_list"][0]["to"][-1] == "Low Sun"
        assert p["tree"][0][-1] == "Low Sun"
        a = c.post("/api/backup-sort", json={"levels": ["year", "folder"]}, headers=h).json()
        assert a["moved"] == 1 and a["undo"] is True
        assert c.get("/api/backup-sort", headers=h).json()["undo"] is True
        u = c.post("/api/backup-sort/undo", headers=h).json()
        assert u["moved"] == 1 and u["levels"] == ["program"]
