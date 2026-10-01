from pathlib import Path
from ablebackup.catalog import Catalog
from ablebackup.service import scan_summary, run_backup
from tests.helpers import write_als, fileref_rel


def _build_project(root: Path):
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def test_scan_summary_is_serializable(tmp_path):
    _build_project(tmp_path)
    projects = scan_summary([tmp_path])
    assert len(projects) == 1
    p = projects[0]
    assert p["name"] == "Song"
    assert p["present_count"] == 1
    assert p["missing_count"] == 0
    assert isinstance(p["project_dir"], str)
    assert isinstance(p["total_size"], int)


def test_run_backup_records_and_emits_progress(tmp_path):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")
    events = []

    summary = run_backup([tmp_path], dest, cat, timestamp="2026-06-06_1430",
                         progress=events.append)

    assert summary["ok_count"] == 1
    assert summary["error_count"] == 0
    assert (dest / "AbletonBackups" / "projects" / "Song" / "2026-06-06_1430" / "Song.als").exists()
    row = cat.snapshots_for("Song")[0]
    assert row["file_count"] == 2
    assert row["daw"] == "ableton"  # DAW recorded per snapshot
    types = [e["type"] for e in events]
    assert "project_start" in types
    assert "project_done" in types
    assert events[-1] == {"type": "backup_done", "ok_count": 1, "error_count": 0,
                          "skipped_count": 0, "mirror_failed": 0, "cancelled": False}
    cat.close()


def test_same_named_projects_do_not_collide_or_false_skip(tmp_path):
    # Two different projects that share the filename "Song.als" in different folders.
    for sub, sample in (("A", b"alpha-loop"), ("B", b"beta-different")):
        proj = tmp_path / sub / "Song Project"
        (proj / "Samples").mkdir(parents=True)
        (proj / "Samples" / "loop.wav").write_bytes(sample)
        write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])
    als_a = str(tmp_path / "A" / "Song Project" / "Song.als")
    als_b = str(tmp_path / "B" / "Song Project" / "Song.als")
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")

    summary = run_backup([tmp_path], dest, cat, timestamp="t1", als_paths=[als_a, als_b])
    # Both backed up — neither false-skips the other, neither overwrites the other.
    assert summary["ok_count"] == 2 and summary["skipped_count"] == 0
    rows = cat.snapshots_for("Song")
    assert len(rows) == 2
    assert len({r["project_id"] for r in rows}) == 2  # distinct identities
    assert len({r["dir"] for r in rows}) == 2          # distinct folders on disk
    for r in rows:
        assert (Path(r["dir"]) / "Song.als").exists()  # both snapshots intact
    cat.close()


def test_run_backup_skips_unchanged_project(tmp_path):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")
    als = [str(tmp_path / "Song Project" / "Song.als")]

    first = run_backup([tmp_path], dest, cat, timestamp="t1", als_paths=als)
    assert first["ok_count"] == 1 and first["skipped_count"] == 0

    # Nothing changed -> second run makes no new snapshot.
    second = run_backup([tmp_path], dest, cat, timestamp="t2", als_paths=als)
    assert second["ok_count"] == 0 and second["skipped_count"] == 1
    assert len(cat.snapshots_for("Song")) == 1

    # Change a sample -> it backs up again.
    (tmp_path / "Song Project" / "Samples" / "loop.wav").write_bytes(b"loopdata-CHANGED-bigger")
    third = run_backup([tmp_path], dest, cat, timestamp="t3", als_paths=als)
    assert third["ok_count"] == 1 and third["skipped_count"] == 0
    assert len(cat.snapshots_for("Song")) == 2
    cat.close()


def test_run_backup_skips_unchanged_partial_project(tmp_path):
    # A project that references a sample not on disk -> status 'partial'. It must
    # still be skip-eligible when nothing changes, or it duplicates forever.
    proj = tmp_path / "Song Project"
    proj.mkdir(parents=True)
    write_als(proj / "Song.als", [fileref_rel("Samples/missing.wav", "missing.wav")])
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")
    als = [str(proj / "Song.als")]

    first = run_backup([tmp_path], dest, cat, timestamp="t1", als_paths=als)
    assert first["ok_count"] == 1
    assert cat.snapshots_for("Song")[0]["status"] == "partial"

    # Still missing, nothing else changed -> no redundant duplicate snapshot.
    second = run_backup([tmp_path], dest, cat, timestamp="t2", als_paths=als)
    assert second["skipped_count"] == 1 and second["ok_count"] == 0
    assert len(cat.snapshots_for("Song")) == 1

    # The missing sample reappears -> signature changes -> it backs up again.
    (proj / "Samples").mkdir()
    (proj / "Samples" / "missing.wav").write_bytes(b"found-it")
    third = run_backup([tmp_path], dest, cat, timestamp="t3", als_paths=als)
    assert third["ok_count"] == 1
    assert len(cat.snapshots_for("Song")) == 2
    cat.close()


def test_portable_change_is_not_skipped(tmp_path):
    # Backing up unchanged content but switching to portable must NOT be skipped —
    # the user asked for a portable snapshot and must get one.
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")
    als = [str(tmp_path / "Song Project" / "Song.als")]

    run_backup([tmp_path], dest, cat, timestamp="t1", als_paths=als, portable=False)
    again = run_backup([tmp_path], dest, cat, timestamp="t2", als_paths=als, portable=True)
    assert again["ok_count"] == 1 and again["skipped_count"] == 0
    cat.close()


def test_run_backup_records_label_and_layout(tmp_path):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")

    run_backup([tmp_path], dest, cat, timestamp="t", label="pre-mix", layout="date_project")

    row = cat.snapshots_for("Song")[0]
    assert row["label"] == "pre-mix"
    assert (dest / "AbletonBackups" / "by-date" / "t" / "Song" / "Song.als").exists()
    assert row["dir"].replace("\\", "/").endswith("by-date/t/Song")  # OS-native separators
    cat.close()


def test_run_backup_can_be_cancelled(tmp_path):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")

    res = run_backup([tmp_path], dest, cat, timestamp="t", should_cancel=lambda: True)

    assert res["cancelled"] is True
    assert res["ok_count"] == 0
    assert cat.snapshots_for("Song") == []  # nothing written when cancelled up front
    cat.close()


def test_run_backup_isolates_project_errors(tmp_path, monkeypatch):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    cat = Catalog(tmp_path / "c.db")

    import ablebackup.service as svc
    def boom(scan, dest_root, timestamp, **kwargs):
        raise OSError("disk full")
    monkeypatch.setattr(svc, "backup_project", boom)

    summary = run_backup([tmp_path], dest, cat, timestamp="t", progress=None)

    assert summary["ok_count"] == 0
    assert summary["error_count"] == 1
    row = cat.snapshots_for("Song")[0]
    assert row["status"] == "error"
    assert "disk full" in row["error"]
    cat.close()
