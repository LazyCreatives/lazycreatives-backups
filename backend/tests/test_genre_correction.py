"""Correcting a project's genre: the producer's pick survives re-scans, can go
back to the guess, and is what /api/library (and so Uploader) reads."""
import sqlite3

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog
from tests.helpers import write_als


def _row(pid, genre, name="Glasshouse"):
    return {"project_id": pid, "name": name, "path": f"/m/{name}.als", "dir": "/m",
            "daw": "ableton", "owner": "bob", "size": 1, "mtime": 1.0, "missing_count": 0,
            "genre": genre, "genre_emoji": "💀", "bpm": 124}


def _lib(cat):
    return {r["project_id"]: r for r in cat.library()}


def test_set_genre_survives_rescan_and_resets(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    cat.upsert_discovered([_row("a", "Phonk")], "t1")
    r = _lib(cat)["a"]
    assert (r["genre"], r["genre_guess"], r["genre_by_you"]) == ("Phonk", "Phonk", 0)

    assert cat.set_project_genre(["a"], "House") == 1
    r = _lib(cat)["a"]
    assert (r["genre"], r["genre_emoji"], r["genre_by_you"]) == ("House", "🏠", 1)

    cat.upsert_discovered([_row("a", "Techno")], "t2")  # a re-scan guesses again
    r = _lib(cat)["a"]
    assert (r["genre"], r["genre_guess"]) == ("House", "Techno")

    cat.set_project_genre(["a"], None)  # back to the guess
    r = _lib(cat)["a"]
    assert (r["genre"], r["genre_by_you"]) == ("Techno", 0)
    cat.upsert_discovered([_row("a", "Trance")], "t3")
    assert _lib(cat)["a"]["genre"] == "Trance"


def test_own_genre_words_are_kept(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    cat.upsert_discovered([_row("a", None)], "t1")
    cat.set_project_genre(["a"], "Gqom")
    r = _lib(cat)["a"]
    assert (r["genre"], r["genre_emoji"], r["genre_by_you"]) == ("Gqom", "🎵", 1)


def test_old_catalog_keeps_its_genres_as_the_guess(tmp_path):
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE discovered (project_id TEXT PRIMARY KEY, name TEXT NOT NULL, "
                "path TEXT NOT NULL, dir TEXT NOT NULL, daw TEXT, owner TEXT, size INTEGER, "
                "mtime REAL, missing_count INTEGER, genre TEXT, genre_emoji TEXT, bpm REAL, "
                "tracks INTEGER, plugins TEXT, found_at TEXT, backed_mtime REAL)")
    con.execute("INSERT INTO discovered (project_id, name, path, dir, genre) VALUES ('a','X','/x','/','DnB')")
    con.commit(); con.close()
    cat = Catalog(db)
    r = _lib(cat)["a"]
    assert (r["genre"], r["genre_guess"], r["genre_by_you"]) == ("DnB", "DnB", 0)


def test_api_sets_genre_and_scan_shows_it(tmp_path):
    src = tmp_path / "src"
    write_als(src / "Glasshouse Project" / "Glasshouse.als", [])
    client = TestClient(create_app(token="t", db_path=tmp_path / "c.db"))
    h = {"X-Auth-Token": "t"}
    found = client.post("/api/scan", json={"sources": [str(src)]}, headers=h).json()["projects"]
    pid = found[0]["project_id"]

    assert "House" in client.get("/api/genres", headers=h).json()["genres"]
    assert client.post("/api/project/genre", json={"project_ids": [pid], "genre": "House"}, headers=h).json()["changed"] == 1
    lib = client.get("/api/library", headers=h).json()["projects"]
    assert (lib[0]["genre"], lib[0]["genre_by_you"]) == ("House", 1)

    again = client.post("/api/scan", json={"sources": [str(src)]}, headers=h).json()["projects"]
    assert again[0]["genre"] == "House"

    client.post("/api/project/genre", json={"project_ids": [pid], "genre": None}, headers=h)
    lib = client.get("/api/library", headers=h).json()["projects"]
    assert (lib[0]["genre"], lib[0]["genre_by_you"]) == (lib[0]["genre_guess"], 0)

    assert client.post("/api/project/genre", json={"project_ids": ["nope"], "genre": "House"}, headers=h).status_code == 404


def test_similar_projects_learn_from_a_correction(tmp_path):
    from ablebackup.service import relearn_genres
    cat = Catalog(tmp_path / "c.db")
    cat.upsert_discovered([_row("a", "Phonk", "Glasshouse"), _row("b", "Phonk", "Velvet"),
                           {**_row("c", "DnB", "Night Bus"), "bpm": 174}], "t1")
    cat.set_project_genre(["a"], "Afrobeats")
    assert relearn_genres(cat) == 1
    lib = _lib(cat)
    assert (lib["b"]["genre"], lib["b"]["genre_by_you"], lib["b"]["genre_guess"]) == ("Afrobeats", 0, "Phonk")
    assert lib["c"]["genre"] == "DnB"             # a different tempo is left alone

    cat.set_project_genre(["a"], None)            # undo: the neighbour goes back too
    relearn_genres(cat)
    assert _lib(cat)["b"]["genre"] == "Phonk"


def test_scan_uses_corrections_but_keeps_the_plain_guess(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    cat.upsert_discovered([{**_row("b", "Afrobeats", "Velvet"), "genre_raw": "Phonk"}], "t1")
    r = _lib(cat)["b"]
    assert (r["genre"], r["genre_guess"]) == ("Afrobeats", "Phonk")
