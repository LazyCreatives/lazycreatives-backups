"""Reading the NAS: project folders kept on it, matching the folders already there,
and finding the same backup twice."""
import json
from pathlib import Path

from ablebackup import doubles, nas, sorting
from ablebackup.catalog import Catalog
from ablebackup.service import run_backup
from tests.helpers import fileref_rel, write_als


def _project(root: Path, name: str, sample: bytes = b"loopdata") -> Path:
    proj = root / f"{name} Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(sample)
    return write_als(proj / f"{name}.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


# ---- Sort like this? ------------------------------------------------------------
def _folders(base: Path, paths):
    for p in paths:
        (base / p).mkdir(parents=True)
        (base / p / "song.als").write_text("x")


def test_years_and_genres_already_on_the_nas_are_read(tmp_path):
    base = tmp_path / "NAS"
    _folders(base, ["2024/House/Night Drive", "2024/Techno/Pulse", "2025/House/Glow", "2025/Trap/Ice"])
    cat = Catalog(tmp_path / "c.db")
    m = sorting.detect(cat, base)
    assert m["levels"] == ["year", "genre"] and m["where"] == "backups"


def test_a_top_folder_and_months_are_understood(tmp_path):
    base = tmp_path / "NAS"
    _folders(base, ["Music Projects/2026-10 October/A", "Music Projects/2026-09 September/B",
                    "Music Projects/2026-08 August/C"])
    assert sorting.detect(Catalog(tmp_path / "c.db"), base)["levels"] == ["month"]


def test_backups_own_folders_or_a_mess_offer_nothing(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    plain = tmp_path / "Plain"
    (plain / "AbletonBackups" / "projects" / "Song" / "2026-10-22_1200").mkdir(parents=True)
    (plain / "AbletonBackups" / "projects" / "Other" / "2026-10-22_1200").mkdir(parents=True)
    assert sorting.detect(cat, plain) is None
    mess = tmp_path / "Mess"
    _folders(mess, ["a/b/c/d", "x", "q/w"])
    assert sorting.detect(cat, mess) is None


def test_already_sorted_like_that_offers_nothing(tmp_path):
    base = tmp_path / "NAS"
    _folders(base, ["2024/A", "2025/B", "2026/C"])
    cat = Catalog(tmp_path / "c.db")
    cat.set_setting(sorting.SORT_KEY, ["year"])
    assert sorting.detect(cat, base) is None


def test_project_folders_are_read_when_the_backup_place_is_empty(tmp_path):
    src = tmp_path / "music"
    for y, g, n in [("2024", "House", "A"), ("2025", "House", "B"), ("2025", "Hip hop", "C")]:
        _project(src / y / g, n)
    cat = Catalog(tmp_path / "c.db")
    cat.set_setting("config", {"sources": [str(src)], "dest": str(tmp_path / "NAS")})
    (tmp_path / "NAS").mkdir()
    from ablebackup.scanner import scan_projects
    cat.upsert_discovered([{"project_id": p.project_id, "name": p.name, "path": str(p.project_path),
                            "dir": str(p.project_dir), "daw": p.daw_id, "owner": "", "size": 1,
                            "mtime": 0, "missing_count": 0} for p in scan_projects([src])], "t")
    m = sorting.detect(cat, tmp_path / "NAS")
    assert m["levels"] == ["path"] and m["kinds"] == ["year", "genre"] and m["where"] == "projects"
    # and backups then go in exactly those folders, whatever the files' own dates say
    run_backup([src], tmp_path / "NAS", cat, timestamp="2026-10-22_1200")
    sorting.apply_sort(cat, tmp_path / "NAS", m["levels"])
    assert (tmp_path / "NAS" / "2024" / "House" / "A" / "2026-10-22_1200").is_dir()
    assert (tmp_path / "NAS" / "2025" / "Hip hop" / "C" / "2026-10-22_1200").is_dir()
    run_backup([src], tmp_path / "NAS", cat, timestamp="2026-10-22_1300", portable=True)  # nothing new
    _project(src / "2026" / "Trap", "D")
    run_backup([src], tmp_path / "NAS", cat, timestamp="2026-10-22_1400")
    assert (tmp_path / "NAS" / "2026" / "Trap" / "D" / "2026-10-22_1400").is_dir()
    cat.set_setting(sorting.SORT_KEY, ["path"])
    assert sorting.detect(cat, tmp_path / "NAS") is None  # no second offer once matched


def test_own_folders_sort_stands_alone(tmp_path):
    assert sorting.clean_levels(["year", "path", "genre"]) == ["path"]
    assert sorting.project_path(["/m"], "/m/2024/House/Night Drive Project", "Night Drive") == ["2024", "House"]
    assert sorting.project_path(["/m"], "/m/2024/House", "Loose") == ["2024", "House"]
    assert sorting.project_path(["/elsewhere"], "/m/x", "x") == []
    assert sorting.project_path(["/m"], "/m/2024/Lo-fi/夜のドライブ 🌙 Project", "夜のドライブ 🌙") == ["2024", "Lo-fi"]
    assert sorting.project_folder_name("/m/Album/夜のドライブ 🌙 Project", "夜のドライブ 🌙") == "Album"


# ---- Same backup twice ------------------------------------------------------------
def _backed(tmp_path):
    src = tmp_path / "music"
    als = _project(src, "Night Drive")
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")
    cat.set_setting("config", {"sources": [str(src)], "dest": str(dest)})
    return src, als, dest, cat


def _force(cat):  # as before 0.3.7: an option change made a whole new copy
    cat.conn.execute("UPDATE snapshots SET signature = 'old'")
    cat.conn.commit()


def test_the_same_backup_in_two_layouts_is_found_and_the_extra_removed(tmp_path):
    src, als, dest, cat = _backed(tmp_path)
    run_backup([src], dest, cat, timestamp="2026-10-20_1200", portable=True)
    _force(cat)
    run_backup([src], dest, cat, timestamp="2026-10-21_1200", portable=False, layout="date_project")
    _force(cat)
    run_backup([src], dest, cat, timestamp="2026-10-22_1200", portable=True)
    found = doubles.find(cat)
    assert found["count"] == 2
    g = found["groups"][0]
    assert g["keep"]["timestamp"] == "2026-10-22_1200"
    assert {e["timestamp"] for e in g["extras"]} == {"2026-10-20_1200", "2026-10-21_1200"}
    r = doubles.remove(cat)
    assert r["removed"] == 2 and r["failed"] == 0
    assert doubles.find(cat)["count"] == 0
    assert [s["timestamp"] for s in cat.snapshots_here()] == ["2026-10-22_1200"]
    assert not (dest / "AbletonBackups" / "by-date").exists()  # empty folders tidied
    assert als.is_file() and (src / "Night Drive Project" / "Samples" / "loop.wav").is_file()


def test_a_changed_project_and_a_named_backup_are_kept(tmp_path):
    src, als, dest, cat = _backed(tmp_path)
    run_backup([src], dest, cat, timestamp="2026-10-20_1200", portable=True)
    (src / "Night Drive Project" / "Samples" / "loop.wav").write_bytes(b"new take")
    run_backup([src], dest, cat, timestamp="2026-10-21_1200", portable=True)
    _force(cat)
    run_backup([src], dest, cat, timestamp="2026-10-22_1200", portable=True, label="before mix")
    assert doubles.find(cat)["count"] == 0


def test_only_backups_backups_made_are_removed(tmp_path):
    src, als, dest, cat = _backed(tmp_path)
    run_backup([src], dest, cat, timestamp="2026-10-20_1200", portable=True)
    _force(cat)
    run_backup([src], dest, cat, timestamp="2026-10-22_1200", portable=True)
    extra = doubles.find(cat)["groups"][0]["extras"][0]
    # someone pointed the catalog row outside the backup place: never removed
    cat.conn.execute("UPDATE snapshots SET dir = ? WHERE id = ?", (str(src / "Night Drive Project"), extra["id"]))
    cat.conn.commit()
    (src / "Night Drive Project" / "manifest.json").write_text(json.dumps({"timestamp": extra["timestamp"]}))
    assert doubles.remove(cat)["removed"] == 0
    assert als.is_file()


# ---- project folders on the NAS ---------------------------------------------------------
def _nas(tmp_path):
    cat = Catalog(tmp_path / "data" / "c.db")
    share = tmp_path / "Volumes" / "Music"
    share.mkdir(parents=True)
    nas.remember(cat, host="tnas.local", address="192.168.1.20", share="Music", user="rob",
                 password="pw", path=share, name="TNAS")
    return cat, share


def test_a_project_share_is_connected_and_remembered(tmp_path, monkeypatch):
    cat, share = _nas(tmp_path)
    projects = tmp_path / "Volumes" / "Projects"
    monkeypatch.setattr(nas, "connect", lambda h, s, u, p: (projects.mkdir(exist_ok=True), projects)[1])
    assert nas.open_share(cat, "Projects") == projects
    assert nas.remembered(cat)["shares"] == {"Projects": str(projects)}
    assert nas.on_nas_path(cat, projects / "2024")
    # connecting the backups share again keeps it
    nas.remember(cat, host="tnas.local", address="", share="Music", user="rob", password="pw", path=share)
    assert nas.remembered(cat)["shares"] == {"Projects": str(projects)}


def test_a_dropped_project_share_is_connected_again_before_a_scan(tmp_path, monkeypatch):
    cat, share = _nas(tmp_path)
    projects = tmp_path / "Volumes" / "Projects"
    cat.set_setting(nas.NAS_KEY, {**nas.remembered(cat), "shares": {"Projects": str(projects)}})
    folder = projects / "2024"
    cat.set_setting("config", {"sources": [str(folder)], "dest": str(share / "B")})
    asked = []

    def wake(h, s, u, p):
        asked.append((s, p))
        folder.mkdir(parents=True)
        return projects
    monkeypatch.setattr(nas, "connect", wake)
    assert nas.ensure_folders(cat, [folder], wait=1, step=0.01) == []
    assert asked == [("Projects", "pw")]


def test_a_project_share_back_at_a_new_path_is_followed(tmp_path, monkeypatch):
    cat, share = _nas(tmp_path)
    old = tmp_path / "Volumes" / "Projects"
    new = tmp_path / "Volumes" / "Projects-1"
    cat.set_setting(nas.NAS_KEY, {**nas.remembered(cat), "shares": {"Projects": str(old)}})
    cat.set_setting("config", {"sources": [str(old / "2024")], "dest": ""})
    monkeypatch.setattr(nas, "connect", lambda *a: ((new / "2024").mkdir(parents=True), new)[1])
    assert nas.ensure_folders(cat, [old / "2024"], wait=1, step=0.01) == []
    assert cat.get_setting("config")["sources"] == [str(new / "2024")]
    assert nas.remembered(cat)["shares"]["Projects"] == str(new)
