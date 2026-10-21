"""Album songs follow their file when it's renamed: by Tidy names (and its Undo), or by
hand in Finder or Explorer. The file is known by its size and save time; nothing but
the album list is ever written."""
import hashlib
import os
import sqlite3
import time
from datetime import datetime
from pathlib import Path

from ablebackup import albums as albums_mod
from ablebackup.albums import Albums, follow_renames


def _song(p: Path, data: bytes = b"RIFF0000WAVE", mtime: float = 1_700_000_000.0) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    os.utime(p, (mtime, mtime))
    return p


def _backups(tmp: Path, renamed=(), exports=()) -> Path:
    """A stand-in for Backups' records: only the two tables albums read."""
    db = tmp / "backups.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE IF NOT EXISTS renamed (old TEXT, new TEXT, kind TEXT, batch_id TEXT, at TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS exports (path TEXT, project_id TEXT, size INTEGER, mtime REAL, hidden INTEGER DEFAULT 0)")
    con.executemany("INSERT INTO renamed VALUES (?, ?, ?, ?, ?)", renamed)
    con.executemany("INSERT INTO exports (path, project_id, size, mtime) VALUES (?, ?, ?, ?)", exports)
    con.commit()
    con.close()
    return db


def _later() -> str:
    return datetime.fromtimestamp(time.time() + 5).strftime("%Y-%m-%d_%H%M%S")


def _digest(folder: Path):
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob("*")) if p.is_file()}


def _setup(tmp_path, *songs):
    albums_mod._missed.clear()
    store = Albums(tmp_path / "albums.db")
    a = store.create("Night Drive")
    store.add_songs(a["id"], [{"path": str(p)} for p in songs])
    return store, a["id"]


def test_renamed_by_hand_follows_and_title_follows(tmp_path):
    old = _song(tmp_path / "Exports" / "untitled 3.wav")
    store, aid = _setup(tmp_path, old)
    store.set_song(aid, str(old), gapless_after=True)
    new = old.with_name("Glasshouse.wav")
    os.rename(old, new)   # what Finder does: same file, same save time
    music = _digest(tmp_path / "Exports")

    assert follow_renames(store, None) is True
    s = store.get(aid)["songs"][0]
    assert s["path"] == str(new) and s["title"] == "Glasshouse" and s["gapless_after"] is True
    assert follow_renames(store, None) is False          # nothing more to do
    assert _digest(tmp_path / "Exports") == music         # the audio is never touched


def test_own_title_stays(tmp_path):
    old = _song(tmp_path / "Exports" / "gh master.wav")
    store, aid = _setup(tmp_path, old)
    store.set_song(aid, str(old), title="Glasshouse")
    os.rename(old, old.with_name("Glasshouse final.wav"))
    follow_renames(store, None)
    s = store.get(aid)["songs"][0]
    assert s["title"] == "Glasshouse" and s["path"].endswith("Glasshouse final.wav")


def test_moved_to_another_folder_found_through_backups(tmp_path):
    old = _song(tmp_path / "Desktop" / "Exit 9.wav", b"RIFF1111WAVE")
    store, aid = _setup(tmp_path, old)
    new = tmp_path / "Music" / "Exit 9 (master).wav"
    new.parent.mkdir()
    os.rename(old, new)
    db = _backups(tmp_path, exports=[(str(new), "p1", new.stat().st_size, new.stat().st_mtime)])
    assert follow_renames(store, db) is True
    assert store.get(aid)["songs"][0]["path"] == str(new)


def test_moved_found_among_the_apps_own_songs(tmp_path):
    old = _song(tmp_path / "A" / "Loose.wav", b"RIFF2222WAVE")
    store, aid = _setup(tmp_path, old)
    new = tmp_path / "B" / "Loose idea.wav"
    new.parent.mkdir()
    os.rename(old, new)
    other = _song(tmp_path / "B" / "Other.wav", b"RIFF9999WAVE9")
    assert follow_renames(store, None, lambda: [str(other), str(new)]) is True
    assert store.get(aid)["songs"][0]["path"] == str(new)


def test_tidy_names_rename_and_swap(tmp_path):
    """Tidy names can shift names along: "v2" becomes "v1" while "FINAL 3" becomes
    "v2". The song that was "v2" must follow to "v1", not stay on the new "v2"."""
    d = tmp_path / "Glasshouse Project"
    v2 = _song(d / "Glasshouse v2.wav", b"RIFF-two-WAVE", 1_700_000_000.0)
    final3 = _song(d / "Glasshouse FINAL 3.wav", b"RIFF-three--WAVE", 1_700_000_100.0)
    store, aid = _setup(tmp_path, v2, final3)
    v1 = d / "Glasshouse v1.wav"
    os.rename(v2, v1)
    os.rename(final3, v2)
    db = _backups(tmp_path, renamed=[(str(v2), str(v1), "file", "b1", _later()),
                                      (str(final3), str(v2), "file", "b1", _later())])
    assert follow_renames(store, db) is True
    assert [Path(s["path"]).name for s in store.get(aid)["songs"]] == ["Glasshouse v1.wav", "Glasshouse v2.wav"]
    # titles that were only file names read as the song's clean name
    assert [s["title"] for s in store.get(aid)["songs"]] == ["Glasshouse", "Glasshouse"]
    assert follow_renames(store, db) is False


def test_tidy_folder_rename_then_undo(tmp_path):
    old_dir = tmp_path / "gh stuff"
    song = _song(old_dir / "gh.wav")
    store, aid = _setup(tmp_path, song)
    new_dir = tmp_path / "Glasshouse"
    os.rename(old_dir, new_dir)
    db = _backups(tmp_path, renamed=[(str(old_dir), str(new_dir), "folder", "b1", _later())],
                  exports=[(str(new_dir / "gh.wav"), "p1", None, None)])
    follow_renames(store, db)
    assert store.get(aid)["songs"][0]["path"] == str(new_dir / "gh.wav")

    # Undo: the names go back, Backups forgets the rename and its exports move back
    os.rename(new_dir, old_dir)
    con = sqlite3.connect(db)
    con.execute("DELETE FROM renamed")
    con.execute("UPDATE exports SET path = ?", (str(song),))
    con.commit()
    con.close()
    follow_renames(store, db)
    assert store.get(aid)["songs"][0]["path"] == str(song)


def test_renamed_before_the_song_was_added_is_ignored(tmp_path):
    """An old Tidy names rename doesn't move a song added later under the old name."""
    d = tmp_path / "P"
    song = _song(d / "Song v2.wav")
    _song(d / "Song v1.wav", b"RIFF-other-WAVE")
    db = _backups(tmp_path, renamed=[(str(song), str(d / "Song v1.wav"), "file", "b0", "2020-01-01_120000")])
    store, aid = _setup(tmp_path, song)
    con = sqlite3.connect(tmp_path / "albums.db")
    con.execute("UPDATE album_songs SET size = NULL, mtime = NULL")   # even without a fingerprint
    con.commit()
    con.close()
    assert follow_renames(store, db) is False
    assert store.get(aid)["songs"][0]["path"] == str(song)


def test_newer_export_saved_over_it_stays(tmp_path):
    song = _song(tmp_path / "E" / "Night Drive.wav")
    store, aid = _setup(tmp_path, song)
    _song(song, b"RIFF-a-newer-and-longer-mix-WAVE", 1_700_009_000.0)   # exported again, same name
    assert follow_renames(store, None) is False
    assert store.get(aid)["songs"][0]["path"] == str(song)
    # and it's now known by the new export, so a rename of that one is followed too
    os.rename(song, song.with_name("Night Drive (final).wav"))
    assert follow_renames(store, None) is True


def test_song_added_before_this_update_uses_its_quality_check(tmp_path):
    """Albums made before songs kept their size and save time: the quality check
    (kept since 0.2.10) knows the file, so a song already broken is found again."""
    song = _song(tmp_path / "E" / "Old one.wav")
    store, aid = _setup(tmp_path, song)
    st = song.stat()
    store.save_check(str(song), st.st_size, st.st_mtime, {"v": 0})
    con = sqlite3.connect(tmp_path / "albums.db")
    con.execute("UPDATE album_songs SET size = NULL, mtime = NULL")
    con.commit()
    con.close()
    os.rename(song, song.with_name("Old one renamed.wav"))
    assert follow_renames(store, None) is True
    assert store.get(aid)["songs"][0]["path"].endswith("Old one renamed.wav")


def test_deleted_song_stays_missing_and_is_not_searched_every_time(tmp_path, monkeypatch):
    song = _song(tmp_path / "E" / "Gone.wav")
    store, aid = _setup(tmp_path, song)
    song.unlink()
    looks = []
    monkeypatch.setattr(albums_mod, "_beside", lambda p, k: looks.append(p))
    assert follow_renames(store, None) is False
    assert follow_renames(store, None) is False
    assert len(looks) == 1
    assert store.get(aid)["songs"][0]["path"] == str(song)


def test_renamed_onto_a_song_already_on_the_album(tmp_path):
    a = _song(tmp_path / "E" / "One.wav", b"RIFF-one-WAVE")
    b = _song(tmp_path / "E" / "One copy.wav", b"RIFF-one-WAVE")
    store, aid = _setup(tmp_path, a, b)
    b.unlink()
    os.rename(a, b)
    assert follow_renames(store, None) is True
    assert [s["path"] for s in store.get(aid)["songs"]] == [str(b)]


def test_tidy_names_in_backups_then_undo_keeps_the_album_playing(tmp_path, monkeypatch):
    """Robert's report: a song on an album was renamed and the album lost it."""
    from fastapi.testclient import TestClient

    from ablebackup.api.app import create_app
    from tests.test_tidy import _glasshouse, _scan

    monkeypatch.setenv("ABLEBACKUP_FREE_BETA", "1")
    monkeypatch.setenv("LC_ALBUMS_DB", str(tmp_path / "albums.db"))
    albums_mod._missed.clear()
    src = tmp_path / "music"
    proj = _glasshouse(src)
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    lib = _scan(c, src)
    pid = lib["Glasshouse FINAL 3"]["project_id"]
    song = proj / "glasshouse final 3 master.wav"
    a = c.post("/api/albums", json={"title": "Glass"}).json()
    c.post(f"/api/albums/{a['id']}/songs", json={"songs": [{"path": str(song)}]})

    done = c.post("/api/tidy/apply", json={"project_ids": [pid], "numbers": "order"}).json()
    s = c.get("/api/albums").json()["albums"][0]["songs"][0]
    assert Path(s["path"]).name == "Glasshouse v2 (master).wav"
    assert s["title"] == "Glasshouse" and "File moved or deleted" not in s["needs"]
    assert c.get("/api/exports/audio", params={"path": s["path"]}).status_code == 200

    last = c.get("/api/tidy/last", params={"project_id": done["id_map"][pid]}).json()["batch"]
    assert c.post("/api/tidy/undo", json={"batch_id": last["id"]}).status_code == 200
    s = c.get("/api/albums").json()["albums"][0]["songs"][0]
    assert s["path"] == str(song) and s["title"] == "Glasshouse"
