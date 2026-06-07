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
        self._migrate()
        self.conn.commit()

    def _migrate(self) -> None:
        # Add columns introduced after the first release to pre-existing catalogs.
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(snapshots)")}
        new = {"label": "TEXT", "dir": "TEXT", "signature": "TEXT",
               "relinked_count": "INTEGER", "verified": "INTEGER", "verified_at": "TEXT",
               "project_id": "TEXT"}
        for col, typ in new.items():
            if col not in cols:
                self.conn.execute(f"ALTER TABLE snapshots ADD COLUMN {col} {typ}")

    def record_snapshot(self, project_name, timestamp, total_size,
                        file_count, status, missing, error=None,
                        label=None, dir="", signature="", relinked_count=0,
                        verified=0, verified_at=None, project_id=None) -> int:
        with self._lock:
            cur = self.conn.execute(
                "INSERT INTO snapshots "
                "(project_name, timestamp, total_size, file_count, status, error, "
                " label, dir, signature, relinked_count, verified, verified_at, project_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (project_name, timestamp, total_size, file_count, status, error,
                 label, dir, signature, relinked_count, verified, verified_at, project_id),
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
                "SUM(total_size) AS total_size "
                "FROM snapshots GROUP BY project_name ORDER BY project_name"
            ).fetchall()
        return [dict(r) for r in rows]

    def latest_signatures(self) -> dict:
        """project_id -> content signature of its most recent *fully ok* snapshot.

        Keyed on project_id (not name) so two same-named projects don't false-skip
        each other; only status='ok' counts, so a partial snapshot keeps retrying.
        """
        with self._lock:
            rows = self.conn.execute(
                "SELECT s.project_id, s.signature FROM snapshots s "
                "JOIN (SELECT project_id, MAX(id) AS mid FROM snapshots "
                "      WHERE status = 'ok' AND project_id IS NOT NULL "
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
                "(SELECT COUNT(*) FROM missing_refs m WHERE m.snapshot_id = s.id) "
                "  AS missing_count "
                "FROM snapshots s "
                "JOIN (SELECT project_name, MAX(id) AS max_id "
                "      FROM snapshots GROUP BY project_name) latest "
                "  ON s.id = latest.max_id "
                "ORDER BY s.timestamp DESC, s.id DESC"
            ).fetchall()
        return [dict(r) for r in rows]

    def close(self):
        with self._lock:
            self.conn.close()
