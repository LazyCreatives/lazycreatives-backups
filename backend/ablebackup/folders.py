"""Folders you sort your projects into: a name and the projects in it.

SHARED FILE: the same file lives in Backups (backend/ablebackup/folders.py) and
Uploader (backend/lazyupload/folders.py). Keep the two byte-identical.

A folder belongs to the apps, not to the computer: putting a project in one never
moves, copies or changes a file. A project can sit in as many folders as you like.
The list is a small SQLite file beside the shared albums list ("Lazy Creatives"
folder), so a folder made in Backups shows in Uploader and on the phone too.

Projects are kept by their Backups project id. An id comes from where the project
file is, so when Backups' Tidy names renames one, Backups calls `rename_projects`.

Each call opens the file, does its work and closes it again. Every change bumps
`rev`, which each app asks for every few seconds to know when to reload.
"""
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

MAX_NAME = 80

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS folder_projects (
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  added_at REAL NOT NULL,
  PRIMARY KEY (folder_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_folder_projects_project ON folder_projects(project_id);
"""


def default_path() -> Path:
    """Beside the shared albums list. LC_FOLDERS_DB overrides it (tests, odd setups)."""
    env = os.environ.get("LC_FOLDERS_DB")
    if env:
        return Path(env)
    albums = os.environ.get("LC_ALBUMS_DB")
    if albums:
        return Path(albums).with_name("folders.db")
    from .albums import default_path as albums_path
    return albums_path().with_name("folders.db")


class NotFound(LookupError):
    pass


def _name(name: str | None) -> str:
    return " ".join((name or "").split())[:MAX_NAME] or "New folder"


class Folders:
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
        """Every folder in your order, each with its project ids (newest added first)."""
        with self._db() as con:
            folders = [dict(r) for r in con.execute("SELECT * FROM folders ORDER BY pos, created_at")]
            ids: dict[str, list[str]] = {}
            for r in con.execute("SELECT folder_id, project_id FROM folder_projects ORDER BY added_at DESC, project_id"):
                ids.setdefault(r["folder_id"], []).append(r["project_id"])
        for f in folders:
            f.pop("pos", None)
            f["project_ids"] = ids.get(f["id"], [])
        return folders

    def get(self, folder_id: str) -> dict:
        """One folder, as in all(). Read on its own: reading every folder to find one
        got slow with thousands of folders."""
        with self._db() as con:
            row = con.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
            if row is None:
                raise NotFound(folder_id)
            ids = [r["project_id"] for r in con.execute(
                "SELECT project_id FROM folder_projects WHERE folder_id = ? ORDER BY added_at DESC, project_id",
                (folder_id,))]
        f = dict(row)
        f.pop("pos", None)
        f["project_ids"] = ids
        return f

    def of_project(self, project_id: str) -> list[str]:
        """The folders a project is in."""
        with self._db() as con:
            return [r["folder_id"] for r in con.execute(
                "SELECT folder_id FROM folder_projects WHERE project_id = ?", (project_id,))]

    # ── changing ─────────────────────────────────────────────────────────────

    def create(self, name: str, project_ids: list[str] | None = None) -> dict:
        fid = uuid.uuid4().hex
        now = time.time()
        with self._db(write=True) as con:
            pos = con.execute("SELECT COALESCE(MAX(pos), -1) + 1 FROM folders").fetchone()[0]
            con.execute("INSERT INTO folders(id, name, pos, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (fid, _name(name), pos, now, now))
            self._add(con, fid, project_ids or [], now)
        return self.get(fid)

    def rename(self, folder_id: str, name: str) -> dict:
        with self._db(write=True) as con:
            cur = con.execute("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?",
                              (_name(name), time.time(), folder_id))
            if not cur.rowcount:
                raise NotFound(folder_id)
        return self.get(folder_id)

    def delete(self, folder_id: str) -> None:
        """The folder goes; its projects stay exactly where they are."""
        with self._db(write=True) as con:
            if not con.execute("DELETE FROM folders WHERE id = ?", (folder_id,)).rowcount:
                raise NotFound(folder_id)

    def reorder(self, folder_ids: list[str]) -> list[dict]:
        with self._db(write=True) as con:
            known = [r["id"] for r in con.execute("SELECT id FROM folders ORDER BY pos, created_at")]
            order = [f for f in folder_ids if f in known] + [f for f in known if f not in folder_ids]
            for i, fid in enumerate(dict.fromkeys(order)):
                con.execute("UPDATE folders SET pos = ? WHERE id = ?", (i, fid))
        return self.all()

    def add(self, folder_id: str, project_ids: list[str]) -> dict:
        with self._db(write=True) as con:
            self._must(con, folder_id)
            self._add(con, folder_id, project_ids, time.time())
        return self.get(folder_id)

    def remove(self, folder_id: str, project_ids: list[str]) -> dict:
        with self._db(write=True) as con:
            self._must(con, folder_id)
            con.executemany("DELETE FROM folder_projects WHERE folder_id = ? AND project_id = ?",
                            [(folder_id, p) for p in project_ids])
            con.execute("UPDATE folders SET updated_at = ? WHERE id = ?", (time.time(), folder_id))
        return self.get(folder_id)

    def rename_projects(self, id_map: dict[str, str]) -> int:
        """Projects that got a new id (renamed by Tidy names) stay in their folders."""
        moves = [(old, new) for old, new in id_map.items() if old and new and old != new]
        if not moves:
            return 0
        with self._db() as con:
            have = {r["project_id"] for r in con.execute("SELECT DISTINCT project_id FROM folder_projects")}
        moves = [(o, n) for o, n in moves if o in have]
        if not moves:
            return 0
        with self._db(write=True) as con:
            for old, new in moves:
                con.execute("UPDATE OR IGNORE folder_projects SET project_id = ? WHERE project_id = ?", (new, old))
                con.execute("DELETE FROM folder_projects WHERE project_id = ?", (old,))
        return len(moves)

    @staticmethod
    def _must(con, folder_id: str) -> None:
        if not con.execute("SELECT 1 FROM folders WHERE id = ?", (folder_id,)).fetchone():
            raise NotFound(folder_id)

    @staticmethod
    def _add(con, folder_id: str, project_ids: list[str], now: float) -> None:
        ids = [p for p in dict.fromkeys(project_ids) if p]
        con.executemany("INSERT OR IGNORE INTO folder_projects(folder_id, project_id, added_at) VALUES (?, ?, ?)",
                        [(folder_id, p, now) for p in ids])
        con.execute("UPDATE folders SET updated_at = ? WHERE id = ?", (now, folder_id))

