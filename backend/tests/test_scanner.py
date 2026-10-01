from ablebackup.scanner import find_als, scan_projects
from tests.helpers import write_als, fileref_rel


def test_finds_als_and_resolves_refs(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"xyz")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])

    results = scan_projects([tmp_path])

    assert len(results) == 1
    scan = results[0]
    assert scan.name == "Song"
    assert scan.project_dir == proj
    assert len(scan.refs) == 1
    assert scan.refs[0].exists is True


def test_skips_backup_and_output_folders(tmp_path):
    proj = tmp_path / "Song Project"
    backup = proj / "Backup"
    backup.mkdir(parents=True)
    write_als(backup / "Song [2023-01-01].als", [])
    out = tmp_path / "AbletonBackups" / "projects" / "Song" / "2026-01-01_1200"
    out.mkdir(parents=True)
    write_als(out / "Song.als", [])
    write_als(proj / "Song.als", [])

    results = scan_projects([tmp_path])

    assert len(results) == 1
    assert results[0].project_dir == proj


def test_scan_skips_unparseable_als(tmp_path):
    good = tmp_path / "Good Project"
    good.mkdir()
    write_als(good / "Good.als", [])
    bad = tmp_path / "Bad Project"
    bad.mkdir()
    (bad / "Bad.als").write_bytes(b"this is not gzip")

    results = scan_projects([tmp_path])

    names = {r.name for r in results}
    assert "Good" in names
    assert "Bad" not in names


def test_scan_emits_progress_events(tmp_path):
    for n in ("Alpha", "Beta"):
        proj = tmp_path / f"{n} Project"
        proj.mkdir()
        write_als(proj / f"{n}.als", [])

    events = []
    scan_projects([tmp_path], progress=events.append)

    types = [e["type"] for e in events]
    assert types[0] == "scan_start"
    assert types[-1] == "scan_done"
    assert events[0]["total"] == 2
    ticks = [e for e in events if e["type"] == "scan_progress"]
    assert len(ticks) == 2
    assert ticks[-1]["done"] == 2 and ticks[-1]["total"] == 2
    assert events[-1]["count"] == 2
