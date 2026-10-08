"""Albums you're putting together: a title, a release date and songs in order.

SHARED FILE: the same file lives in Backups (backend/ablebackup/albums.py) and
Uploader (backend/lazyupload/albums.py). Keep the two byte-identical.

Both apps read and change one shared list, so an album made or reordered in one app
shows in the other. The list is a small SQLite file in a "Lazy Creatives" folder
beside the apps' own records (not inside either app's folder, so it works with only
one of them installed). Songs are kept by the path of their audio file; the audio
itself is only ever read, never changed, copied or converted.

Each call opens the file, does its work and closes it again, so the two apps never
hold it open against each other. Every change bumps `rev`, which each app asks for
every few seconds to know when to reload.
"""
import os
import re
import sqlite3
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

LOSSLESS = {".wav", ".aiff", ".aif", ".flac", ".aifc"}
AUDIO = LOSSLESS | {".mp3", ".aac", ".m4a", ".ogg", ".wma", ".opus"}
MAX_FADE = 12.0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  release_date TEXT NOT NULL DEFAULT '',
  crossfade REAL NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS album_songs (
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  gapless_after INTEGER NOT NULL DEFAULT 0,
  ready INTEGER,
  genre TEXT NOT NULL DEFAULT '',
  added_at REAL NOT NULL,
  PRIMARY KEY (album_id, path)
);
"""


def default_path() -> Path:
    """Where the shared list lives. LC_ALBUMS_DB overrides it (tests, odd setups)."""
    env = os.environ.get("LC_ALBUMS_DB")
    if env:
        return Path(env)
    home = Path.home()
    if sys.platform == "darwin":
        base = home / "Library" / "Application Support"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming")
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or home / ".config")
    return base / "Lazy Creatives" / "albums.db"


class NotFound(LookupError):
    pass


class Albums:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else None

    @contextmanager
    def _db(self, write: bool = False):
        p = self.path or default_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(str(p), timeout=10)
        try:
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA busy_timeout = 10000")
            con.execute("PRAGMA foreign_keys = ON")
            try:
                con.execute("PRAGMA journal_mode = WAL")
            except sqlite3.OperationalError:
                pass  # some network drives refuse it; the default journal still works
            con.executescript(_SCHEMA)
            if "genre" not in {r["name"] for r in con.execute("PRAGMA table_info(album_songs)")}:
                # a list made before songs kept their genre (the colour of the album's stripe)
                con.execute("ALTER TABLE album_songs ADD COLUMN genre TEXT NOT NULL DEFAULT ''")
            if write:
                con.execute("BEGIN IMMEDIATE")
            yield con
            if write:
                con.execute("INSERT INTO meta(key, value) VALUES ('rev', '1') "
                            "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1")
                con.commit()
        except BaseException:
            con.rollback()
            raise
        finally:
            con.close()

    # ── reading ──────────────────────────────────────────────────────────────

    def rev(self) -> int:
        with self._db() as con:
            row = con.execute("SELECT value FROM meta WHERE key = 'rev'").fetchone()
        return int(row["value"]) if row else 0

    def all(self) -> list[dict]:
        with self._db() as con:
            albums = [dict(r) for r in con.execute(
                "SELECT * FROM albums ORDER BY (release_date = ''), release_date, created_at")]
            songs: dict[str, list[dict]] = {}
            for r in con.execute("SELECT * FROM album_songs ORDER BY album_id, pos"):
                d = dict(r)
                d["gapless_after"] = bool(d["gapless_after"])
                d["ready"] = None if d["ready"] is None else bool(d["ready"])
                songs.setdefault(d.pop("album_id"), []).append(d)
        for a in albums:
            a["songs"] = songs.get(a["id"], [])
            for s in a["songs"]:
                s.pop("pos", None)
        return albums

    def get(self, album_id: str) -> dict:
        for a in self.all():
            if a["id"] == album_id:
                return a
        raise NotFound(album_id)

    def paths(self) -> set[str]:
        """Every song path on any album (so each app's player may play them)."""
        with self._db() as con:
            return {r["path"] for r in con.execute("SELECT DISTINCT path FROM album_songs")}

    # ── changing ─────────────────────────────────────────────────────────────

    def create(self, title: str, release_date: str = "") -> dict:
        title = (title or "").strip() or "Untitled album"
        aid = uuid.uuid4().hex
        now = time.time()
        with self._db(write=True) as con:
            con.execute("INSERT INTO albums(id, title, release_date, crossfade, created_at, updated_at) "
                        "VALUES (?, ?, ?, 0, ?, ?)", (aid, title, _date(release_date), now, now))
        return self.get(aid)

    def update(self, album_id: str, *, title: str | None = None, release_date: str | None = None,
               crossfade: float | None = None) -> dict:
        sets, args = [], []
        if title is not None:
            sets.append("title = ?"); args.append(title.strip() or "Untitled album")
        if release_date is not None:
            sets.append("release_date = ?"); args.append(_date(release_date))
        if crossfade is not None:
            sets.append("crossfade = ?"); args.append(max(0.0, min(MAX_FADE, float(crossfade))))
        with self._db(write=True) as con:
            self._touch(con, album_id, sets, args)
        return self.get(album_id)

    def delete(self, album_id: str) -> None:
        with self._db(write=True) as con:
            if not con.execute("DELETE FROM albums WHERE id = ?", (album_id,)).rowcount:
                raise NotFound(album_id)

    def add_songs(self, album_id: str, songs: list[dict]) -> dict:
        """Add songs to the end. Each is {path, title?, project?, genre?}; a song already
        on the album is left where it is."""
        now = time.time()
        with self._db(write=True) as con:
            self._touch(con, album_id)
            have = {r["path"] for r in con.execute("SELECT path FROM album_songs WHERE album_id = ?", (album_id,))}
            pos = con.execute("SELECT COALESCE(MAX(pos), -1) FROM album_songs WHERE album_id = ?",
                              (album_id,)).fetchone()[0]
            for s in songs:
                path = str(s.get("path") or "")
                if not path or path in have or Path(path).suffix.lower() not in AUDIO:
                    continue
                pos += 1
                have.add(path)
                con.execute("INSERT INTO album_songs(album_id, pos, path, title, project, genre, added_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (album_id, pos, path, (s.get("title") or "").strip() or Path(path).stem,
                             (s.get("project") or "").strip(), (s.get("genre") or "").strip(), now))
        return self.get(album_id)

    def remove_song(self, album_id: str, path: str) -> dict:
        with self._db(write=True) as con:
            self._touch(con, album_id)
            con.execute("DELETE FROM album_songs WHERE album_id = ? AND path = ?", (album_id, path))
        return self.get(album_id)

    def reorder(self, album_id: str, paths: list[str]) -> dict:
        """Put the songs in this order. Songs left out keep their order after the rest
        (so a change made in the other app at the same moment isn't lost)."""
        with self._db(write=True) as con:
            self._touch(con, album_id)
            have = [r["path"] for r in con.execute(
                "SELECT path FROM album_songs WHERE album_id = ? ORDER BY pos", (album_id,))]
            want = [p for p in dict.fromkeys(paths) if p in have]
            order = want + [p for p in have if p not in want]
            for i, p in enumerate(order):
                con.execute("UPDATE album_songs SET pos = ? WHERE album_id = ? AND path = ?", (i, album_id, p))
        return self.get(album_id)

    def set_song(self, album_id: str, path: str, *, title: str | None = None,
                 gapless_after: bool | None = None, ready: bool | None | str = "keep") -> dict:
        """Change one song: its title on the album, whether it runs straight into the
        next song, or whether you've marked it ready yourself (None = let the app judge)."""
        sets, args = [], []
        if title is not None:
            sets.append("title = ?"); args.append(title.strip() or Path(path).stem)
        if gapless_after is not None:
            sets.append("gapless_after = ?"); args.append(int(bool(gapless_after)))
        if ready != "keep":
            sets.append("ready = ?"); args.append(None if ready is None else int(bool(ready)))
        with self._db(write=True) as con:
            self._touch(con, album_id)
            if sets and not con.execute(f"UPDATE album_songs SET {', '.join(sets)} WHERE album_id = ? AND path = ?",
                                        (*args, album_id, path)).rowcount:
                raise NotFound(path)
        return self.get(album_id)

    def _touch(self, con, album_id: str, sets: list[str] | None = None, args: list | None = None):
        sets = [*(sets or []), "updated_at = ?"]
        if not con.execute(f"UPDATE albums SET {', '.join(sets)} WHERE id = ?",
                           (*(args or []), time.time(), album_id)).rowcount:
            raise NotFound(album_id)


def _date(s: str | None) -> str:
    s = (s or "").strip()
    return s if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) else ""


# ── what still needs doing ─────────────────────────────────────────────────────
# Judged the same way in both apps, from the file itself and, when Backups is
# installed, from Backups' own records (opened read-only).

_UNTITLED = re.compile(r"^(untitled|new project|idea|audio|track|song|mix(down)?|master|bounce|export)"
                       r"[\s_-]*\d*$", re.I)
# A project saved this long after the song was exported has probably changed since.
_SAVED_AFTER = 120


def has_lossless(path: str) -> bool:
    p = Path(path)
    if p.suffix.lower() in LOSSLESS:
        return True
    try:
        return any(p.with_suffix(ext).is_file() or p.with_suffix(ext.upper()).is_file() for ext in LOSSLESS)
    except OSError:
        return False


def file_checks(song: dict) -> list[str]:
    """Plain-English things a song still needs, from its file and title."""
    out = []
    path = song.get("path") or ""
    try:
        exists = Path(path).is_file()
    except OSError:
        exists = False
    if not exists:
        return ["File moved or deleted"]
    if not has_lossless(path):
        out.append("Needs a WAV")
    if _UNTITLED.match((song.get("title") or "").strip()):
        out.append("Needs a title")
    return out


def project_info(paths: list[str], backups_db: Path | None) -> dict[str, dict]:
    """For each song Backups has linked to a project: the project and its backup state.
    Empty when Backups isn't installed or its records can't be read."""
    if not paths or not backups_db:
        return {}
    try:
        if not Path(backups_db).is_file():
            return {}
        con = sqlite3.connect(f"file:{Path(backups_db).as_posix()}?mode=ro", uri=True, timeout=5)
    except (OSError, sqlite3.Error):
        return {}
    out: dict[str, dict] = {}
    try:
        con.row_factory = sqlite3.Row
        marks = ",".join("?" * len(paths))
        cols = {r["name"] for r in con.execute("PRAGMA table_info(discovered)")}
        genre = "d.genre" if "genre" in cols else "''"
        rows = con.execute(
            f"SELECT e.path, e.mtime AS exported, d.project_id, d.name, d.daw, {genre} AS genre, d.path AS file, "
            "d.mtime AS saved, d.backed_mtime AS backed FROM exports e "
            "JOIN discovered d ON d.project_id = e.project_id "
            f"WHERE e.hidden = 0 AND e.path IN ({marks})", list(paths)).fetchall()
        for r in rows:
            saved, backed, exported = r["saved"], r["backed"], r["exported"]
            try:  # the project's save time read live, as Backups' own Library does
                saved = os.stat(r["file"]).st_mtime
            except (OSError, TypeError):
                pass
            if backed is None:
                backup = "safe" if _has_backup(con, r["project_id"]) else "none"
            else:
                backup = "changed" if saved and saved > backed + 1 else "safe"
            out[r["path"]] = {
                "project_id": r["project_id"], "project": r["name"], "daw": r["daw"] or "",
                "genre": r["genre"] or "", "backup": backup,
                "changed_since_export": bool(saved and exported and saved > exported + _SAVED_AFTER),
            }
    except sqlite3.Error:
        return {}
    finally:
        con.close()
    return out


def _has_backup(con, project_id: str) -> bool:
    try:
        return con.execute("SELECT 1 FROM snapshots WHERE project_id = ? LIMIT 1", (project_id,)).fetchone() is not None
    except sqlite3.Error:
        return False


def judge_album(album: dict, backups_db: Path | None) -> dict:
    """Fill in each song's project (from Backups), `needs` (what's missing) and
    `is_ready` (your own tick wins). A song's genre is its project's in Backups (the
    producer's own pick wins there), else the one it had when it was added."""
    info = project_info([s["path"] for s in album["songs"]], backups_db)
    for s in album["songs"]:
        p = info.get(s["path"])
        needs = file_checks(s)
        if p:
            s["project_id"], s["daw"], s["backup"] = p["project_id"], p["daw"], p["backup"]
            s["project"] = s.get("project") or p["project"]
            s["genre"] = p["genre"] or s.get("genre") or ""
            if p["changed_since_export"] and needs != ["File moved or deleted"]:
                needs.append("Project changed since export")
        else:
            s.setdefault("project_id", None)
            s.setdefault("backup", None)
        s.setdefault("genre", "")
        s["needs"] = needs
        s["is_ready"] = s["ready"] if s.get("ready") is not None else not needs
    return album
