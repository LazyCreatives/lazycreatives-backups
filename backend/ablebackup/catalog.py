import sqlite3
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
"""


class Catalog:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)
        self.conn.commit()

    def record_snapshot(self, project_name, timestamp, total_size,
                        file_count, status, missing, error=None) -> int:
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
        rows = self.conn.execute(
            "SELECT * FROM snapshots WHERE project_name = ? ORDER BY timestamp",
            (project_name,),
        ).fetchall()
        return [dict(r) for r in rows]

    def missing_for(self, snapshot_id) -> list[str]:
        rows = self.conn.execute(
            "SELECT expected_path FROM missing_refs WHERE snapshot_id = ?",
            (snapshot_id,),
        ).fetchall()
        return [r["expected_path"] for r in rows]

    def close(self):
        self.conn.close()
