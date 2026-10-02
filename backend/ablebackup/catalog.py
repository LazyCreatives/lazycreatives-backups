import json
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
    genre TEXT,                    -- guessed at scan time (BPM + name/sample keywords)
    genre_emoji TEXT,
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
    PRIMARY KEY (path, project_id)
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
                         "tracks": "INTEGER", "plugins": "TEXT"}.items():
            if col not in dcols:
                self.conn.execute(f"ALTER TABLE discovered ADD COLUMN {col} {typ}")

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
                "(project_id, name, path, dir, daw, owner, size, mtime, missing_count, genre, genre_emoji, bpm, tracks, plugins, found_at) "
                "VALUES (:project_id, :name, :path, :dir, :daw, :owner, :size, :mtime, :missing_count, :genre, :genre_emoji, :bpm, :tracks, :plugins, :found_at) "
                "ON CONFLICT(project_id) DO UPDATE SET "
                "  name=excluded.name, path=excluded.path, dir=excluded.dir, daw=excluded.daw, "
                "  owner=excluded.owner, size=excluded.size, mtime=excluded.mtime, "
                "  missing_count=excluded.missing_count, genre=excluded.genre, "
                "  genre_emoji=excluded.genre_emoji, bpm=excluded.bpm, "
                "  tracks=excluded.tracks, plugins=excluded.plugins, found_at=excluded.found_at",
                # default genre/meta fields so rows that omit them still bind cleanly
                [{"genre": None, "genre_emoji": None, "bpm": None, "tracks": None,
                  "plugins": None, **r, "found_at": found_at} for r in rows],
            )
            self.conn.commit()
        return len(rows)

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
            d["backed_up"] = d["last_backup"] is not None
            try:  # stored as a JSON array; serve a real list
                d["plugins"] = json.loads(d["plugins"]) if d.get("plugins") else []
            except (TypeError, ValueError):
                d["plugins"] = []
            out.append(d)
        return out

    # ---- exports (song renders linked to projects) ------------------------------
    def discovered_projects(self) -> list[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT project_id, name, dir, daw, mtime FROM discovered").fetchall()
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
                "INSERT OR IGNORE INTO exports (path, project_id, name, size, mtime, match) "
                "VALUES (:path, :project_id, :name, :size, :mtime, :match)", rows)
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
                "SELECT * FROM exports WHERE hidden = 0 ORDER BY mtime ASC").fetchall()
        out: dict[str, dict] = {}
        for r in rows:
            cur = out.setdefault(r["project_id"], {"count": 0, "latest": None})
            cur["count"] += 1
            cur["latest"] = dict(r)  # ASC => the newest wins
        return out

    def link_export(self, path: str, project_id: str, name: str, size, mtime) -> None:
        with self._lock:
            self.conn.execute(
                "INSERT INTO exports (path, project_id, name, size, mtime, match, hidden) "
                "VALUES (?, ?, ?, ?, ?, 'manual', 0) "
                "ON CONFLICT(path, project_id) DO UPDATE SET match = 'manual', hidden = 0, "
                "  size = excluded.size, mtime = excluded.mtime",
                (path, project_id, name, size, mtime))
            self.conn.commit()

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
