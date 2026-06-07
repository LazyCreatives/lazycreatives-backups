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
    error TEXT
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
        self.conn.commit()

    def record_snapshot(self, project_name, timestamp, total_size,
                        file_count, status, missing, error=None) -> int:
        with self._lock:
            cur = self.conn.execute(
                "INSERT INTO snapshots "
                "(project_name, timestamp, total_size, file_count, status, error) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (project_name, timestamp, total_size, file_count, status, error),
            )
            sid = cur.lastrowid
            self.conn.executemany(
                "INSERT INTO missing_refs (snapshot_id, expected_path) VALUES (?, ?)",
                [(sid, p) for p in missing],
            )
            self.conn.commit()
            return sid

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
