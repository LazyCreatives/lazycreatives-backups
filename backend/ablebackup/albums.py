"""Albums you're putting together: a title, a release date and songs in order.

SHARED FILE: the same file lives in Backups (backend/ablebackup/albums.py) and
Uploader (backend/lazyupload/albums.py). Keep the two byte-identical.

Both apps read and change one shared list, so an album made or reordered in one app
shows in the other. The list is a small SQLite file in a "Lazy Creatives" folder
beside the apps' own records (not inside either app's folder, so it works with only
one of them installed). Songs are kept by the path of their audio file; the audio
itself is only ever read, never changed, copied or converted. Each song also keeps
its file's size and save time, so the album can follow the file when it's renamed
(by Backups' Tidy names, or by hand in Finder or Explorer).

Each call opens the file, does its work and closes it again, so the two apps never
hold it open against each other. Every change bumps `rev`, which each app asks for
every few seconds to know when to reload.
"""
import json
import os
import re
import sqlite3
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Callable

from . import songcheck
from .names import song_title

LOSSLESS = {".wav", ".aiff", ".aif", ".flac", ".aifc"}
AUDIO = LOSSLESS | {".mp3", ".aac", ".m4a", ".ogg", ".wma", ".opus"}
MAX_FADE = 12.0
# What an album can be called. '' means "go by its length" (single, EP or album, as stores count it).
KINDS = ("single", "EP", "album", "LP", "mixtape", "compilation")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  release_date TEXT NOT NULL DEFAULT '',
  crossfade REAL NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT '',
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
  size INTEGER,
  mtime REAL,
  PRIMARY KEY (album_id, path)
);
CREATE TABLE IF NOT EXISTS song_checks (
  path TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime REAL NOT NULL,
  info TEXT NOT NULL,
  checked_at REAL NOT NULL
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
    def _db(self, write: bool = False, bump: bool = True):
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
            song_cols = {r["name"] for r in con.execute("PRAGMA table_info(album_songs)")}
            if "genre" not in song_cols:
                # a list made before songs kept their genre (the colour of the album's stripe)
                con.execute("ALTER TABLE album_songs ADD COLUMN genre TEXT NOT NULL DEFAULT ''")
            if "size" not in song_cols:
                # the file's size and save time, to know it again after a rename
                con.execute("ALTER TABLE album_songs ADD COLUMN size INTEGER")
                con.execute("ALTER TABLE album_songs ADD COLUMN mtime REAL")
            cols = {r["name"] for r in con.execute("PRAGMA table_info(albums)")}
            if "kind" not in cols:
                # what the producer calls it (single, EP, album, LP...); '' = go by its length
                con.execute("ALTER TABLE albums ADD COLUMN kind TEXT NOT NULL DEFAULT ''")
            if "soundcloud" not in cols:
                # where Uploader last put the album on SoundCloud (a playlist), as JSON
                con.execute("ALTER TABLE albums ADD COLUMN soundcloud TEXT NOT NULL DEFAULT ''")
            if not con.execute("SELECT 1 FROM meta WHERE key = 'titles_cleaned'").fetchone():
                # Once: songs added before titles were cleaned get the clean title. Done
                # here a single time, so a title later set to the file name stays.
                for r in con.execute("SELECT rowid, title, path FROM album_songs").fetchall():
                    if r["title"] == Path(r["path"]).stem and song_title(r["title"]) != r["title"]:
                        con.execute("UPDATE album_songs SET title = ? WHERE rowid = ?",
                                    (song_title(r["title"]), r["rowid"]))
                con.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('titles_cleaned', '1')")
                con.commit()
            if write:
                con.execute("BEGIN IMMEDIATE")
            yield con
            if write and bump:
                con.execute("INSERT INTO meta(key, value) VALUES ('rev', '1') "
                            "ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1")
            if write:
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
                d.pop("size", None)
                d.pop("mtime", None)
                songs.setdefault(d.pop("album_id"), []).append(d)
        for a in albums:
            a["soundcloud"] = _json(a.get("soundcloud"))
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
               crossfade: float | None = None, kind: str | None = None) -> dict:
        sets, args = [], []
        if kind is not None:
            if kind and kind not in KINDS:
                raise ValueError(f"unknown kind {kind!r}")
            sets.append("kind = ?"); args.append(kind)
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
                st = _stat(path)
                con.execute("INSERT INTO album_songs(album_id, pos, path, title, project, genre, added_at, size, mtime) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (album_id, pos, path, _title(s.get("title"), path),
                             (s.get("project") or "").strip(), (s.get("genre") or "").strip(), now,
                             st.st_size if st else None, st.st_mtime if st else None))
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
            sets.append("title = ?"); args.append(title.strip() or song_title(Path(path).stem))
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

    def swap_song(self, album_id: str, path: str, new_path: str) -> dict:
        """Put another file (a newer export of the same song) in this song's place. It
        keeps its place, title and join; your own Ready tick goes, since the file is new.
        Neither file is changed."""
        if Path(new_path).suffix.lower() not in AUDIO:
            raise ValueError("That isn't an audio file")
        with self._db(write=True) as con:
            self._touch(con, album_id)
            if con.execute("SELECT 1 FROM album_songs WHERE album_id = ? AND path = ?",
                           (album_id, new_path)).fetchone():
                raise ValueError("That file is already on this album")
            st = _stat(new_path)
            if not con.execute("UPDATE album_songs SET path = ?, ready = NULL, added_at = ?, size = ?, mtime = ? "
                               "WHERE album_id = ? AND path = ?",
                               (new_path, time.time(), st.st_size if st else None,
                                st.st_mtime if st else None, album_id, path)).rowcount:
                raise NotFound(path)
        return self.get(album_id)

    def set_soundcloud(self, album_id: str, link: dict | None) -> dict:
        """Remember where the album is on SoundCloud (Uploader writes it, both apps show it)."""
        with self._db(write=True) as con:
            self._touch(con, album_id, ["soundcloud = ?"], [json.dumps(link) if link else ""])
        return self.get(album_id)

    # ── song checks, kept so each song is only read once per version of its file ─

    def cached_check(self, path: str, size: int, mtime: float) -> dict | None:
        with self._db() as con:
            r = con.execute("SELECT * FROM song_checks WHERE path = ?", (path,)).fetchone()
        if not r or r["size"] != size or abs(r["mtime"] - mtime) > 0.001:
            return None
        info = _json(r["info"])
        return info if info and info.get("v") == songcheck.MEASURE_VERSION else None

    def save_check(self, path: str, size: int, mtime: float, info: dict) -> None:
        # Not a change to any album, so the apps aren't told to reload.
        with self._db(write=True, bump=False) as con:
            con.execute("INSERT INTO song_checks(path, size, mtime, info, checked_at) VALUES (?, ?, ?, ?, ?) "
                        "ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, "
                        "info = excluded.info, checked_at = excluded.checked_at",
                        (path, size, mtime, json.dumps(info), time.time()))

    def _touch(self, con, album_id: str, sets: list[str] | None = None, args: list | None = None):
        sets = [*(sets or []), "updated_at = ?"]
        if not con.execute(f"UPDATE albums SET {', '.join(sets)} WHERE id = ?",
                           (*(args or []), time.time(), album_id)).rowcount:
            raise NotFound(album_id)


# ── following a song when its file is renamed ───────────────────────────────────

# A song whose file can't be found is looked for again at most this often (seconds).
_LOOK_AGAIN = 60.0
_missed: dict[str, float] = {}


def follow_renames(store: Albums, backups_db: Path | None,
                   more_paths: Callable[[], list[str]] | None = None) -> bool:
    """Point each album song at its file again after the file was renamed or moved.

    The file is known by its size and save time (a rename changes neither). It's
    followed through Backups' own record of Tidy names renames (and their Undo), then
    looked for beside its old place, then among the songs Backups has linked to
    projects and the app's own songs (`more_paths`). A file that's still there under
    its old name, or a newer export saved over it, stays as it is. Nothing is renamed,
    moved or written except the album list. Says whether any song moved."""
    with store._db() as con:
        songs = [dict(r) for r in con.execute(
            "SELECT album_id, path, title, added_at, size, mtime FROM album_songs")]
        checked = {r["path"]: (r["size"], r["mtime"]) for r in con.execute(
            "SELECT path, size, mtime FROM song_checks")}
    if not songs:
        return False
    renames: list[dict] | None = None
    pool: list[tuple[str, int | None, float | None]] | None = None
    fill: list[tuple] = []
    moves: list[tuple[dict, str, os.stat_result]] = []
    now = time.time()
    for s in songs:
        path = s["path"]
        known = (s["size"], s["mtime"]) if s["size"] is not None else checked.get(path)
        st = _stat(path)
        if st and (known is None or _same(st, known)):
            if s["size"] is None or not _same(st, (s["size"], s["mtime"])):
                fill.append((st.st_size, st.st_mtime, s["album_id"], path))
            continue
        # the file is gone, or a different file has its name now
        if renames is None:
            renames = _tidy_renames(backups_db)
        new = _follow_tidy(renames, path, s["added_at"])
        nst = _stat(new) if new != path else None
        if nst and (known is None or _same(nst, known)):
            moves.append((s, new, nst))
            continue
        if st:  # a newer export saved under the same name: it's still this song
            fill.append((st.st_size, st.st_mtime, s["album_id"], path))
            continue
        if known is None or now - _missed.get(path, 0) < _LOOK_AGAIN:
            continue
        found = _beside(path, known)
        if not found:
            if pool is None:
                pool = _pool(backups_db, more_paths)
            found = _in_pool(pool, path, known)
        if found:
            moves.append((s, found, _stat(found)))
            _missed.pop(path, None)
        else:
            _missed[path] = now
    if fill:
        with store._db(write=True, bump=False) as con:
            con.executemany("UPDATE album_songs SET size = ?, mtime = ? WHERE album_id = ? AND path = ?", fill)
    if not moves:
        return False
    with store._db(write=True) as con:
        for s, new, nst in moves:
            aid, old = s["album_id"], s["path"]
            if con.execute("SELECT 1 FROM album_songs WHERE album_id = ? AND path = ?", (aid, new)).fetchone():
                con.execute("DELETE FROM album_songs WHERE album_id = ? AND path = ?", (aid, old))
                continue
            # a title that was only the old file name (or its clean name) follows the new
            # name; your own stays
            title = (song_title(Path(new).stem)
                     if s["title"] in (Path(old).stem, song_title(Path(old).stem)) else s["title"])
            con.execute("UPDATE album_songs SET path = ?, title = ?, size = ?, mtime = ? "
                        "WHERE album_id = ? AND path = ?",
                        (new, title, nst.st_size if nst else None, nst.st_mtime if nst else None, aid, old))
            if not Path(old).exists():
                con.execute("UPDATE OR IGNORE song_checks SET path = ? WHERE path = ?", (new, old))
    return True


def _title(title: str | None, path: str) -> str:
    """A song's title on an album: the one given, cleaned when it is only the file's
    name ("glasshouse final 3 master" -> "Glasshouse"); your own title stays."""
    t = (title or "").strip()
    return song_title(Path(path).stem) if not t or t == Path(path).stem else t


def _stat(path: str) -> os.stat_result | None:
    try:
        st = os.stat(path)
    except (OSError, ValueError):
        return None
    return st if os.path.isfile(path) else None


def _same(st: os.stat_result, known: tuple) -> bool:
    size, mtime = known
    # some drives (FAT, exFAT, network shares) keep save times to the nearest 2 seconds
    return st.st_size == size and mtime is not None and abs(st.st_mtime - mtime) <= 2.0


def _tidy_renames(backups_db: Path | None) -> list[dict]:
    """Backups' record of files and folders renamed by Tidy names, oldest first
    (opened read-only). An Undo takes its rows away again."""
    if not backups_db:
        return []
    try:
        if not Path(backups_db).is_file():
            return []
        con = sqlite3.connect(f"file:{Path(backups_db).as_posix()}?mode=ro", uri=True, timeout=5)
    except (OSError, sqlite3.Error):
        return []
    try:
        con.row_factory = sqlite3.Row
        rows = [dict(r) for r in con.execute(
            "SELECT old, new, kind, batch_id, at FROM renamed WHERE kind IN ('file', 'folder') "
            "ORDER BY at, rowid")]
    except sqlite3.Error:
        return []
    finally:
        con.close()
    for r in rows:
        try:
            r["t"] = datetime.strptime(r["at"], "%Y-%m-%d_%H%M%S").timestamp()
        except (TypeError, ValueError):
            r["t"] = 0.0
    return rows


def _follow_tidy(rows: list[dict], path: str, since: float) -> str:
    """Where Tidy names renames made after `since` took this file, batch by batch
    (within one rename each name moves once, as names can swap)."""
    batches: list[tuple[dict, list]] = []
    current = None
    for r in rows:
        if r["t"] < since - 2:
            continue
        if not batches or r["batch_id"] != current:
            current = r["batch_id"]
            batches.append(({}, []))
        names, folders = batches[-1]
        if r["kind"] == "folder":
            folders.append((r["old"], r["new"]))
        else:
            names[r["old"]] = r["new"]
    for names, folders in batches:
        if path in names:
            path = names[path]
            continue
        for o, n in folders:
            if path.startswith(o + os.sep):
                path = n + path[len(o):]
                break
    return path


def _beside(path: str, known: tuple) -> str | None:
    """The same file under another name in its old folder."""
    old = Path(path)
    try:
        names = sorted(os.listdir(old.parent))
    except OSError:
        return None
    for name in names:
        p = old.parent / name
        if p.suffix.lower() in AUDIO and name != old.name and (st := _stat(str(p))) and _same(st, known):
            return str(p)
    return None


def _pool(backups_db: Path | None, more_paths: Callable[[], list[str]] | None) -> list[tuple]:
    """Songs to look among: Backups' linked exports (with the size and save time it
    noted) and the app's own songs."""
    out: list[tuple] = []
    if backups_db:
        try:
            if Path(backups_db).is_file():
                con = sqlite3.connect(f"file:{Path(backups_db).as_posix()}?mode=ro", uri=True, timeout=5)
                try:
                    out += [(p, size, mtime) for p, size, mtime in
                            con.execute("SELECT path, size, mtime FROM exports WHERE hidden = 0")]
                finally:
                    con.close()
        except (OSError, sqlite3.Error):
            pass
    if more_paths:
        try:
            out += [(p, None, None) for p in more_paths() if p]
        except Exception:
            pass
    return out


def _in_pool(pool: list[tuple], path: str, known: tuple) -> str | None:
    ext = Path(path).suffix.lower()
    seen = set()
    for p, size, mtime in pool:
        if p == path or p in seen or Path(p).suffix.lower() != ext:
            continue
        seen.add(p)
        if size is not None and size != known[0]:
            continue  # Backups noted another size: not this file (saves reading it)
        st = _stat(p)
        if st and _same(st, known):
            return p
    return None


def _json(raw) -> dict | None:
    try:
        v = json.loads(raw) if raw else None
    except ValueError:
        return None
    return v if isinstance(v, dict) else None


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


# What a song needs when its file can't be opened here.
GONE = {"File moved or deleted", "Not on this computer"}


def elsewhere(path: str) -> bool:
    """A song kept by another computer (albums can be shared through the backup place):
    a path for another kind of computer, or one whose top folders ("/Users/sam",
    "D:\\Music") aren't on this one."""
    if not path:
        return False
    win = "\\" in path or (len(path) > 1 and path[1] == ":")
    if win != (sys.platform == "win32"):
        return True
    parts = Path(path).parts
    top = Path(*parts[:3]) if len(parts) > 3 else Path(path).parent
    try:
        return not top.is_dir()
    except OSError:
        return True


def file_checks(song: dict) -> list[str]:
    """Plain-English things a song still needs, from its file and title."""
    out = []
    path = song.get("path") or ""
    try:
        exists = Path(path).is_file()
    except OSError:
        exists = False
    if not exists:
        return ["Not on this computer" if elsewhere(path) else "File moved or deleted"]
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
        bpm = "d.bpm" if "bpm" in cols else "NULL"
        rows = con.execute(
            f"SELECT e.path, e.mtime AS exported, d.project_id, d.name, d.daw, {genre} AS genre, {bpm} AS bpm, d.path AS file, "
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
                "genre": r["genre"] or "", "backup": backup, "bpm": r["bpm"],
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
            s["bpm"] = round(p["bpm"]) if p["bpm"] and 10 <= p["bpm"] <= 999 else None  # misreads blank
            s["working"] = p["changed_since_export"]
            if p["changed_since_export"] and not set(needs) & GONE:
                needs.append("Still working on it")
        else:
            s.setdefault("project_id", None)
            s.setdefault("backup", None)
            s["bpm"], s["working"] = None, False
        s.setdefault("genre", "")
        s["needs"] = needs
        s["is_ready"] = s["ready"] if s.get("ready") is not None else not needs
    return album


def check_song(store: Albums, path: str) -> dict:
    """Will this song play anywhere (see songcheck)? The file is read once per version of
    it: the result is kept with the album list, so both apps share it."""
    out = {"path": path, "state": "ok", "summary": "", "problems": [], "lufs": None, "true_peak_db": None}
    try:
        st = Path(path).stat()
    except OSError:
        return {**out, "state": "missing"}
    info = store.cached_check(path, st.st_size, st.st_mtime)
    if info is None:
        try:
            info = songcheck.measure(path)
        except songcheck.CannotCheck:
            return {**out, "state": "unreadable"}
        store.save_check(path, st.st_size, st.st_mtime, info)
    problems = songcheck.judge(info)
    return {**out, "state": "check" if problems else "ok", "summary": songcheck.summary(info),
            "problems": problems, "lufs": info.get("lufs"), "true_peak_db": info.get("true_peak_db")}
