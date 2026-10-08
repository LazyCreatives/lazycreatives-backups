"""Rescans skip re-reading project files that haven't changed, and stay correct."""
import os
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup import scanner
from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog
from ablebackup.scanner import ParseCache, scan_projects
from tests.helpers import fileref_rel, write_als


def _proj(root: Path, name: str, samples: list[str]) -> Path:
    proj = root / f"{name} Project"
    (proj / "Samples").mkdir(parents=True, exist_ok=True)
    for s in samples:
        (proj / "Samples" / s).write_bytes(b"x")
    als = proj / f"{name}.als"
    write_als(als, [fileref_rel(f"Samples/{s}", s) for s in samples])
    return als


def _count_reads(monkeypatch):
    reads = []
    real = scanner._parse_in_worker
    monkeypatch.setattr(scanner, "_parse_in_worker", lambda p: (reads.append(p), real(p))[1])
    monkeypatch.setattr(scanner, "_PARALLEL_THRESHOLD", 10**9)  # in-process, so reads are seen
    return reads


def test_unchanged_files_are_not_read_again(tmp_path, monkeypatch):
    src = tmp_path / "music"
    for n in ("A", "B", "C"):
        _proj(src, n, ["kick.wav"])
    cat = Catalog(tmp_path / "c.db")
    reads = _count_reads(monkeypatch)

    first = scan_projects([src], cache=ParseCache(cat))
    assert len(reads) == 3
    reads.clear()
    cache = ParseCache(cat)
    again = scan_projects([src], cache=cache)
    assert reads == [] and cache.hits == 3
    assert [(p.name, len(p.refs)) for p in again] == [(p.name, len(p.refs)) for p in first]


def test_a_saved_project_is_read_again(tmp_path, monkeypatch):
    src = tmp_path / "music"
    a = _proj(src, "A", ["kick.wav"])
    _proj(src, "B", ["kick.wav"])
    cat = Catalog(tmp_path / "c.db")
    reads = _count_reads(monkeypatch)
    scan_projects([src], cache=ParseCache(cat))
    reads.clear()
    # A is saved in the DAW with a new sample
    (a.parent / "Samples" / "snare.wav").write_bytes(b"y")
    write_als(a, [fileref_rel("Samples/kick.wav", "kick.wav"), fileref_rel("Samples/snare.wav", "snare.wav")])
    st = a.stat()
    os.utime(a, ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))
    out = {p.name: p for p in scan_projects([src], cache=ParseCache(cat))}
    assert [Path(r).name for r in reads] == ["A.als"]
    assert len(out["A"].refs) == 2


def test_samples_are_still_checked_on_disk(tmp_path, monkeypatch):
    """A cached read never hides a sample that went missing since."""
    src = tmp_path / "music"
    a = _proj(src, "A", ["kick.wav"])
    cat = Catalog(tmp_path / "c.db")
    scan_projects([src], cache=ParseCache(cat))
    (a.parent / "Samples" / "kick.wav").unlink()
    [p] = scan_projects([src], cache=ParseCache(cat))
    assert len(p.missing) == 1


def test_another_reader_version_reads_again(tmp_path, monkeypatch):
    src = tmp_path / "music"
    _proj(src, "A", ["kick.wav"])
    cat = Catalog(tmp_path / "c.db")
    scan_projects([src], cache=ParseCache(cat))
    monkeypatch.setattr(scanner, "_reader_version", lambda: "next-version")
    cache = ParseCache(cat)
    scan_projects([src], cache=cache)
    assert cache.hits == 0


def test_api_rescan_uses_the_cache_and_gives_the_same_answer(tmp_path):
    src = tmp_path / "music"
    for n in ("A", "B", "C", "D", "E"):
        _proj(src, n, ["kick.wav", "hat.wav"])
    app = create_app(token="", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        one = c.post("/api/scan", json={"sources": [str(src)]}).json()["projects"]
        two = c.post("/api/scan", json={"sources": [str(src)]}).json()["projects"]
        cached = app.state.catalog.parse_cache_load(ParseCache(None).ver)
    key = lambda ps: sorted((p["name"], p["present_count"], p["missing_count"]) for p in ps)
    assert key(one) == key(two) and len(one) == 5
    assert len(cached) == 5
