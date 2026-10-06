import json
import os
import re
import time
import sqlite3
import threading
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    total_size INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    label TEXT,
    dir TEXT
);
CREATE TABLE IF NOT EXISTS missing_refs (
    snapshot_id INTEGER NOT NULL,
    expected_path TEXT NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- Every project a scan has ever found, backed up or not. This is what History
-- shows as your library; backed-up status is derived by joining `snapshots`.
CREATE TABLE IF NOT EXISTS discovered (
    project_id TEXT PRIMARY KEY,   -- stable id from the project file path
    name TEXT NOT NULL,
    path TEXT NOT NULL,            -- the project file (.als/.flp/…)
    dir TEXT NOT NULL,             -- the project folder
    daw TEXT,
    owner TEXT,                    -- macOS user (or volume) the project lives under
    size INTEGER,
    mtime REAL,
    missing_count INTEGER,
    genre TEXT,                    -- the genre shown everywhere: the producer's pick, else the guess
    genre_emoji TEXT,
    genre_guess TEXT,              -- what the last scan guessed (BPM + name/sample keywords)
    genre_by_you INTEGER DEFAULT 0, -- 1 when the producer set the genre; scans then keep it
    bpm REAL,
    tracks INTEGER,                -- content track/lane count (NULL if the format hides it)
    plugins TEXT,                  -- JSON array of plugin names used by the project
    found_at TEXT                  -- when a scan last saw it
);
-- Song exports (bounces/renders) linked to the project they came from. One row per
-- (file, project). match: 'folder' | 'name' (automatic, rebuilt on refresh) or
-- 'manual' (user-linked). hidden=1 records "not from this project" so an automatic
-- match never comes back. Uploader reads this table (read-only) to know exactly
-- which project a song came from.
CREATE TABLE IF NOT EXISTS exports (
    path TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size INTEGER,
    mtime REAL,
    match TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL DEFAULT 'song', -- 'song' or 'stem' (one part of a song)
    why TEXT,                          -- plain words for the clue that linked it
    sure INTEGER NOT NULL DEFAULT 1,   -- 0 = a guess (shown with a dotted underline)
    PRIMARY KEY (path, project_id)
);
-- Songs in exports folders that no project matched, rebuilt on refresh, with the
-- project they're most likely from. ignored=1 is "not a song", kept across refreshes.
CREATE TABLE IF NOT EXISTS unmatched_exports (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    size INTEGER,
    mtime REAL,
    kind TEXT NOT NULL DEFAULT 'song',
    suggest_id TEXT,
    suggest_why TEXT,
    ignored INTEGER NOT NULL DEFAULT 0
);
-- "Tidy names": each rename the user made from a project page, with everything
-- needed to put every name back (one click Undo). steps = [[from, to], ...] in the
-- order they were done; file_map/dir_map/id_map record where things ended up.
CREATE TABLE IF NOT EXISTS tidy_batches (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    summary TEXT NOT NULL,
    project_ids TEXT NOT NULL,     -- JSON: the projects' ids after the rename
    steps TEXT NOT NULL,
    file_map TEXT NOT NULL,
    dir_map TEXT NOT NULL,
    id_map TEXT NOT NULL,
    undone_at TEXT
);
-- Old name -> new name for everything a tidy moved, so anything that remembered the
-- old one can follow it: Uploader reads this (read-only) to keep a renamed song tied
-- to its SoundCloud upload and its project. kind: 'file' | 'folder' | 'project' (ids).
-- An undo deletes its batch's rows.
CREATE TABLE IF NOT EXISTS renamed (
    old TEXT NOT NULL,
    new TEXT NOT NULL,
    kind TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    at TEXT NOT NULL
);
"""

# Indexes for the columns we filter/join/group on. missing_refs.snapshot_id is the
# join key for every history lookup; project_name/project_id back the dashboard's
# latest-per-project and signature aggregations. Created after _migrate adds columns.
_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_missing_snapshot ON missing_refs(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_project_name ON snapshots(project_name);
CREATE INDEX IF NOT EXISTS idx_snapshots_project_id ON snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_exports_project ON exports(project_id);
"""


def _changed_since_backup(d: dict) -> bool:
    """Has the project been saved since its last backup? Uses the project file's
    current save time (read live, so an edit shows without a re-scan) against the
    time recorded at its last backup; older catalogs fall back to the backup's own
    timestamp."""
    mtime = d.get("mtime") or 0
    try:
        mtime = os.stat(d["path"]).st_mtime
    except (OSError, KeyError, TypeError):
        pass
    base = d.get("backed_mtime")
    if base is None:
        try:  # "2026-10-05_1213" in local time, minute resolution
            base = time.mktime(time.strptime(d["last_backup"], "%Y-%m-%d_%H%M")) + 60
        except (TypeError, ValueError):
            return False
    return mtime > base + 1


def _natural(s: str) -> list:
    """Sort key that orders numbers by value: "v2" before "v10"."""
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.split(r"(\d+)", s.lower()) if t]


class Catalog:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: the connection is shared across FastAPI's
        # threadpool + the backup worker thread; the lock serializes access.
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self.conn.executescript(_SCHEMA)
        self._migrate()  # add post-release columns (e.g. project_id) before indexing them
        self.conn.executescript(_INDEXES)
        self.conn.commit()

    def _migrate(self) -> None:
        # Add columns introduced after the first release to pre-existing catalogs.
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(snapshots)")}
        new = {"label": "TEXT", "dir": "TEXT", "signature": "TEXT",
               "relinked_count": "INTEGER", "verified": "INTEGER", "verified_at": "TEXT",
               "project_id": "TEXT", "daw": "TEXT",
               # guessed genre (cached per snapshot; genre_done marks it computed)
               "genre": "TEXT", "bpm": "REAL", "genre_conf": "REAL",
               "genre_done": "INTEGER"}
        for col, typ in new.items():
            if col not in cols:
                self.conn.execute(f"ALTER TABLE snapshots ADD COLUMN {col} {typ}")
        # discovered: genre + metadata columns added after that table shipped
        dcols = {r["name"] for r in self.conn.execute("PRAGMA table_info(discovered)")}
        for col, typ in {"genre": "TEXT", "genre_emoji": "TEXT", "bpm": "REAL",
                         "tracks": "INTEGER", "plugins": "TEXT",
                         # the project file's save time when it was last backed up
                         # (or found identical to its last backup)
                         "backed_mtime": "REAL",
                         # genre correction: the latest guess, and whether the
                         # producer set the genre themselves
                         "genre_guess": "TEXT", "genre_by_you": "INTEGER DEFAULT 0"}.items():
            if col not in dcols:
                self.conn.execute(f"ALTER TABLE discovered ADD COLUMN {col} {typ}")
        if "genre_guess" not in dcols:  # until the next scan, the stored genre is the guess
            self.conn.execute("UPDATE discovered SET genre_guess = genre")
        # exports: stems and "guessed" links, added after that table shipped
        ecols = {r["name"] for r in self.conn.execute("PRAGMA table_info(exports)")}
        for col, typ in {"kind": "TEXT NOT NULL DEFAULT 'song'", "why": "TEXT",
                         "sure": "INTEGER NOT NULL DEFAULT 1"}.items():
            if col not in ecols:
                self.conn.execute(f"ALTER TABLE exports ADD COLUMN {col} {typ}")

    def record_snapshot(self, project_name, timestamp, total_size,
                        file_count, status, missing, error=None,
                        label=None, dir="", signature="", relinked_count=0,
                        verified=0, verified_at=None, project_id=None,
                        daw="ableton") -> int:
        with self._lock:
            cur = self.conn.execute(
                "INSERT INTO snapshots "
                "(project_name, timestamp, total_size, file_count, status, error, "
                " label, dir, signature, relinked_count, verified, verified_at, project_id, daw) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (project_name, timestamp, total_size, file_count, status, error,
                 label, dir, signature, relinked_count, verified, verified_at, project_id, daw),
            )
            sid = cur.lastrowid
            self.conn.executemany(
                "INSERT INTO missing_refs (snapshot_id, expected_path) VALUES (?, ?)",
                [(sid, p) for p in missing],
            )
            self.conn.commit()
            return sid

    def get_snapshot(self, snapshot_id) -> dict | None:
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM snapshots WHERE id = ?", (snapshot_id,)
            ).fetchone()
        return dict(row) if row else None

    def set_verified(self, snapshot_id, verified, verified_at, status=None) -> None:
        with self._lock:
            if status is not None:
                self.conn.execute(
                    "UPDATE snapshots SET verified = ?, verified_at = ?, status = ? WHERE id = ?",
                    (verified, verified_at, status, snapshot_id),
                )
            else:
                self.conn.execute(
                    "UPDATE snapshots SET verified = ?, verified_at = ? WHERE id = ?",
                    (verified, verified_at, snapshot_id),
                )
            self.conn.commit()

    def snapshots_for(self, project_name) -> list[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT * FROM snapshots WHERE project_name = ? ORDER BY timestamp",
                (project_name,),
            ).fetchall()
        return [dict(r) for r in rows]

    def missing_for(self, snapshot_id) -> list[str]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT expected_path FROM missing_refs WHERE snapshot_id = ?",
                (snapshot_id,),
            ).fetchall()
        return [r["expected_path"] for r in rows]

    def missing_for_snapshots(self, snapshot_ids) -> dict[int, list[str]]:
        """Missing-ref paths for many snapshots in one query (avoids the N+1 of
        calling missing_for per row). Returns {snapshot_id: [paths]}; ids with no
        missing refs are simply absent from the map."""
        ids = list(snapshot_ids)
        out: dict[int, list[str]] = {}
        if not ids:
            return out
        placeholders = ",".join("?" * len(ids))
        with self._lock:
            rows = self.conn.execute(
                f"SELECT snapshot_id, expected_path FROM missing_refs "
                f"WHERE snapshot_id IN ({placeholders})",
                ids,
            ).fetchall()
        for r in rows:
            out.setdefault(r["snapshot_id"], []).append(r["expected_path"])
        return out

    def set_setting(self, key, value) -> None:
        with self._lock:
            self.conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )
            self.conn.commit()

    def get_setting(self, key, default=None):
        with self._lock:
            row = self.conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            return default
        return json.loads(row["value"])

    def recent_snapshots(self, limit=50) -> list[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT * FROM snapshots ORDER BY timestamp DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def projects_summary(self) -> list[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT project_name, "
                "COUNT(*) AS snapshot_count, "
                "MAX(timestamp) AS last_timestamp, "
                "SUM(total_size) AS total_size, "
                "MAX(daw) AS daw "
                "FROM snapshots GROUP BY project_name ORDER BY project_name"
            ).fetchall()
        return [dict(r) for r in rows]

    def latest_signatures(self) -> dict:
        """project_id -> content signature of its most recent successful snapshot.

        Keyed on project_id (not name) so two same-named projects don't false-skip
        each other. Includes 'partial' (some samples missing) as well as 'ok',
        because the signature already encodes which samples are present — so if a
        missing sample reappears the signature changes and a new backup is made;
        an identical-signature partial has genuinely nothing new to capture and is
        skipped (this is what stops endless duplicate backups of projects that have
        a permanently-missing sample). Only failed ('error') snapshots are excluded.
        """
        with self._lock:
            rows = self.conn.execute(
                "SELECT s.project_id, s.signature FROM snapshots s "
                "JOIN (SELECT project_id, MAX(id) AS mid FROM snapshots "
                "      WHERE status IN ('ok', 'partial') AND project_id IS NOT NULL "
                "      GROUP BY project_id) l "
                "  ON s.id = l.mid"
            ).fetchall()
        return {r["project_id"]: r["signature"] for r in rows if r["signature"]}

    def snapshot_totals(self) -> dict:
        """Aggregate counts/sizes across all snapshots, for the dashboard."""
        with self._lock:
            row = self.conn.execute(
                "SELECT COUNT(*) AS snapshot_count, "
                "COUNT(DISTINCT project_name) AS projects_protected, "
                "COALESCE(SUM(total_size), 0) AS logical_size "
                "FROM snapshots"
            ).fetchone()
        return dict(row)

    def latest_per_project(self) -> list[dict]:
        """The most recent snapshot of each project, with its missing-ref count.

        Used for both 'last run' and the dashboard's 'needs attention' list.
        """
        with self._lock:
            rows = self.conn.execute(
                "SELECT s.id, s.project_name, s.timestamp, s.status, s.error, "
                "s.dir, s.daw, s.genre, s.bpm, s.genre_conf, s.genre_done, "
                "(SELECT COUNT(*) FROM missing_refs m WHERE m.snapshot_id = s.id) "
                "  AS missing_count "
                "FROM snapshots s "
                "JOIN (SELECT project_name, MAX(id) AS max_id "
                "      FROM snapshots GROUP BY project_name) latest "
                "  ON s.id = latest.max_id "
                "ORDER BY s.timestamp DESC, s.id DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def upsert_discovered(self, rows: list[dict], found_at: str) -> int:
        """Record/refresh discovered projects (keyed by project_id). Returns the count.

        A re-scan updates name/path/size/missing for projects it sees again; projects
        no longer present are left in place (History keeps showing them — the file may
        just be on an unplugged drive) and simply aren't refreshed."""
        if not rows:
            return 0
        with self._lock:
            self.conn.executemany(
                "INSERT INTO discovered "
                "(project_id, name, path, dir, daw, owner, size, mtime, missing_count, genre, genre_emoji, genre_guess, bpm, tracks, plugins, found_at) "
                "VALUES (:project_id, :name, :path, :dir, :daw, :owner, :size, :mtime, :missing_count, :genre, :genre_emoji, :genre_raw, :bpm, :tracks, :plugins, :found_at) "
                "ON CONFLICT(project_id) DO UPDATE SET "
                "  name=excluded.name, path=excluded.path, dir=excluded.dir, daw=excluded.daw, "
                "  owner=excluded.owner, size=excluded.size, mtime=excluded.mtime, "
                "  missing_count=excluded.missing_count, genre_guess=excluded.genre_guess, "
                # a genre the producer set survives every re-scan
                "  genre=CASE WHEN discovered.genre_by_you = 1 THEN discovered.genre ELSE excluded.genre END, "
                "  genre_emoji=CASE WHEN discovered.genre_by_you = 1 THEN discovered.genre_emoji ELSE excluded.genre_emoji END, "
                "  bpm=excluded.bpm, "
                "  tracks=excluded.tracks, plugins=excluded.plugins, found_at=excluded.found_at",
                # default genre/meta fields so rows that omit them still bind cleanly
                [{"genre": None, "genre_emoji": None, "bpm": None, "tracks": None,
                  "plugins": None, **r, "genre_raw": r.get("genre_raw", r.get("genre")),
                  "found_at": found_at} for r in rows],
            )
            self.conn.commit()
        return len(rows)

    def set_project_genre(self, project_ids: list[str], genre: str | None) -> int:
        """Set the genre of these projects (the producer's correction), or with
        genre=None go back to what the app guessed. Returns how many changed."""
        from ablebackup.genre import emoji_for
        if not project_ids:
            return 0
        marks = ",".join("?" * len(project_ids))
        with self._lock:
            if genre:
                cur = self.conn.execute(
                    f"UPDATE discovered SET genre = ?, genre_emoji = ?, genre_by_you = 1 "
                    f"WHERE project_id IN ({marks})", (genre, emoji_for(genre), *project_ids))
                n = cur.rowcount
            else:
                rows = self.conn.execute(
                    f"SELECT project_id, genre_guess FROM discovered WHERE project_id IN ({marks})",
                    project_ids).fetchall()
                for r in rows:
                    g = r["genre_guess"]
                    self.conn.execute(
                        "UPDATE discovered SET genre = ?, genre_emoji = ?, genre_by_you = 0 "
                        "WHERE project_id = ?", (g, emoji_for(g) if g else None, r["project_id"]))
                n = len(rows)
            self.conn.commit()
        return n

    def genre_examples(self) -> list[tuple]:
        """[(bpm, genre)] for projects the producer corrected: what the guesser learns from."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT bpm, genre FROM discovered WHERE genre_by_you = 1 "
                "AND genre IS NOT NULL AND bpm IS NOT NULL").fetchall()
        return [(r["bpm"], r["genre"]) for r in rows]

    def genre_rows(self) -> list[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT project_id, name, bpm, genre, genre_guess, genre_by_you FROM discovered").fetchall()
        return [dict(r) for r in rows]

    def set_guessed_genre(self, project_id: str, genre, emoji) -> None:
        with self._lock:
            self.conn.execute(
                "UPDATE discovered SET genre = ?, genre_emoji = ? WHERE project_id = ? AND genre_by_you = 0",
                (genre, emoji, project_id))
            self.conn.commit()

    def genres_set_by_you(self) -> list[dict]:
        """[{project_id, name, genre}] for projects whose genre the producer set."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT project_id, name, genre FROM discovered "
                "WHERE genre_by_you = 1 AND genre IS NOT NULL").fetchall()
        return [dict(r) for r in rows]

    def mark_backed(self, project_id: str, mtime: float) -> None:
        """Remember the project file's save time as of a backup that captured it (or
        found it identical to the last one), so later edits show as changed."""
        with self._lock:
            self.conn.execute("UPDATE discovered SET backed_mtime = ? WHERE project_id = ?",
                              (mtime, project_id))
            self.conn.commit()

    def library(self) -> list[dict]:
        """Every discovered project + its backed-up status (latest backup time and
        snapshot count), derived by matching snapshots on project_id OR name so both
        new (id-tagged) and legacy backups are recognised. This is the History list."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT d.*, "
                "  (SELECT MAX(s.timestamp) FROM snapshots s "
                "     WHERE (s.project_id = d.project_id OR s.project_name = d.name) "
                "       AND s.status IN ('ok','partial')) AS last_backup, "
                "  (SELECT COUNT(*) FROM snapshots s "
                "     WHERE s.project_id = d.project_id OR s.project_name = d.name) AS snapshot_count "
                "FROM discovered d "
                "ORDER BY d.owner, d.name"
            ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            # the project file's save time as it is now, so a project saved in the
            # music program since the last scan sorts as just worked on
            try:
                d["mtime"] = max(d.get("mtime") or 0, os.stat(d["path"]).st_mtime)
            except (OSError, KeyError, TypeError):
                pass
            d["backed_up"] = d["last_backup"] is not None
            d["changed"] = d["backed_up"] and _changed_since_backup(d)
            try:  # stored as a JSON array; serve a real list
                d["plugins"] = json.loads(d["plugins"]) if d.get("plugins") else []
            except (TypeError, ValueError):
                d["plugins"] = []
            out.append(d)
        # versions in natural order: "Song v2" before "Song v10"
        out.sort(key=lambda d: ((d.get("owner") or ""), _natural(d.get("name") or "")))
        return out

    # ---- exports (song renders linked to projects) ------------------------------
    def discovered_projects(self) -> list[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT project_id, name, path, dir, daw, mtime, backed_mtime FROM discovered"
            ).fetchall()
        return [dict(r) for r in rows]

    def snapshot_names(self) -> list[dict]:
        """Each backup's project id, name, folder and time: used to remember a
        project's earlier names and when it was worked on."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT project_id, project_name, dir, timestamp FROM snapshots").fetchall()
        return [dict(r) for r in rows]

    def export_choices(self) -> list[dict]:
        """Songs you linked by hand or said aren't from a project."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT path, project_id, name, match, hidden FROM exports "
                "WHERE match = 'manual' OR hidden = 1").fetchall()
        return [dict(r) for r in rows]

    def replace_auto_exports(self, rows: list[dict], keep_existing: bool = False) -> int:
        """Swap in a fresh set of automatic matches. Manual links and dismissed
        ("not from this project") rows are kept and take precedence. With
        ``keep_existing`` (part of the disk couldn't be checked) earlier automatic
        matches are kept too and the new ones added."""
        with self._lock:
            if not keep_existing:
                self.conn.execute(
                    "DELETE FROM exports WHERE match IN ('folder', 'name') AND hidden = 0")
            self.conn.executemany(
                "INSERT OR IGNORE INTO exports "
                "(path, project_id, name, size, mtime, match, kind, why, sure) "
                "VALUES (:path, :project_id, :name, :size, :mtime, :match, :kind, :why, :sure)",
                [{"kind": "song", "why": None, "sure": 1, **r} for r in rows])
            self.conn.commit()
            n = self.conn.execute(
                "SELECT COUNT(*) FROM exports WHERE match IN ('folder', 'name') AND hidden = 0"
            ).fetchone()[0]
        return n

    def exports_for(self, project_id: str) -> list[dict]:
        """Visible exports of one project, newest first."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT * FROM exports WHERE project_id = ? AND hidden = 0 "
                "ORDER BY mtime DESC", (project_id,)).fetchall()
        return [dict(r) for r in rows]

    def latest_exports(self) -> dict[str, dict]:
        """project_id -> {count, latest export row} for the Library list."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT * FROM exports WHERE hidden = 0 AND kind != 'stem' "
                "ORDER BY mtime ASC").fetchall()
        out: dict[str, dict] = {}
        for r in rows:
            cur = out.setdefault(r["project_id"], {"count": 0, "latest": None})
            cur["count"] += 1
            cur["latest"] = dict(r)  # ASC => the newest wins
        return out

    def link_export(self, path: str, project_id: str, name: str, size, mtime,
                    kind: str = "song") -> None:
        with self._lock:
            self.conn.execute(
                "INSERT INTO exports (path, project_id, name, size, mtime, match, hidden, "
                "  kind, why, sure) "
                "VALUES (?, ?, ?, ?, ?, 'manual', 0, ?, 'added by you', 1) "
                "ON CONFLICT(path, project_id) DO UPDATE SET match = 'manual', hidden = 0, "
                "  size = excluded.size, mtime = excluded.mtime, kind = excluded.kind, "
                "  why = excluded.why, sure = 1",
                (path, project_id, name, size, mtime, kind))
            self.conn.commit()

    # ---- songs no project matched ------------------------------------------------
    def replace_unmatched(self, rows: list[dict], keep_existing: bool = False) -> None:
        """Swap in the songs the last re-check couldn't match. "Not a song" marks
        survive; with ``keep_existing`` earlier rows are kept too."""
        with self._lock:
            if not keep_existing:
                self.conn.execute("DELETE FROM unmatched_exports WHERE ignored = 0")
            self.conn.executemany(
                "INSERT INTO unmatched_exports "
                "(path, name, size, mtime, kind, suggest_id, suggest_why) "
                "VALUES (:path, :name, :size, :mtime, :kind, :suggest_id, :suggest_why) "
                "ON CONFLICT(path) DO UPDATE SET name = excluded.name, size = excluded.size, "
                "  mtime = excluded.mtime, kind = excluded.kind, "
                "  suggest_id = excluded.suggest_id, suggest_why = excluded.suggest_why",
                rows)
            self.conn.commit()

    def unmatched(self, ignored: bool = False) -> list[dict]:
        """Songs waiting for a project, newest first (leaving out any since linked)."""
        with self._lock:
            rows = self.conn.execute(
                "SELECT u.* FROM unmatched_exports u WHERE u.ignored = ? AND NOT EXISTS "
                "(SELECT 1 FROM exports e WHERE e.path = u.path AND e.hidden = 0) "
                "ORDER BY u.mtime DESC", (1 if ignored else 0,)).fetchall()
        return [dict(r) for r in rows]

    def ignore_unmatched(self, path: str, ignored: bool = True) -> bool:
        with self._lock:
            cur = self.conn.execute("UPDATE unmatched_exports SET ignored = ? WHERE path = ?",
                                    (1 if ignored else 0, path))
            self.conn.commit()
        return cur.rowcount > 0

    def is_unmatched(self, path: str) -> bool:
        with self._lock:
            row = self.conn.execute("SELECT 1 FROM unmatched_exports WHERE path = ? LIMIT 1",
                                    (path,)).fetchone()
        return row is not None

    def hide_export(self, path: str, project_id: str) -> bool:
        with self._lock:
            cur = self.conn.execute(
                "UPDATE exports SET hidden = 1 WHERE path = ? AND project_id = ?",
                (path, project_id))
            self.conn.commit()
        return cur.rowcount > 0

    def is_export(self, path: str) -> bool:
        """True if path is a visible, linked export (guards the audio endpoint)."""
        with self._lock:
            row = self.conn.execute(
                "SELECT 1 FROM exports WHERE path = ? AND hidden = 0 LIMIT 1",
                (path,)).fetchone()
        return row is not None

    def set_genre(self, snapshot_id, genre, bpm, confidence) -> None:
        """Cache a snapshot's guessed genre so it isn't recomputed each load."""
        with self._lock:
            self.conn.execute(
                "UPDATE snapshots SET genre = ?, bpm = ?, genre_conf = ?, genre_done = 1 "
                "WHERE id = ?",
                (genre, bpm, confidence, snapshot_id),
            )
            self.conn.commit()

    def close(self):
        with self._lock:
            self.conn.close()
