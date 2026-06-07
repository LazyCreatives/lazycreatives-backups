"""Orchestration layer: reusable scan/backup over the engine, with progress events."""
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from ablebackup.backup_engine import backup_project
from ablebackup.catalog import Catalog
from ablebackup.scanner import scan_projects

ProgressCb = Optional[Callable[[dict], None]]


def default_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H%M")


def _pool_size(dest_root: Path) -> int:
    """Actual bytes on disk in the dedup pool (the unique-file set)."""
    pool = dest_root / "_pool"
    total = 0
    if pool.exists():
        for dirpath, _dirs, files in os.walk(pool):
            for fn in files:
                try:
                    total += (Path(dirpath) / fn).stat().st_size
                except OSError:
                    pass
    return total


def build_overview(catalog: Catalog, dest: str) -> dict:
    """A health snapshot for the dashboard: totals, dedup savings, NAS status, attention."""
    totals = catalog.snapshot_totals()
    latest = catalog.latest_per_project()

    attention = [
        {
            "project_name": s["project_name"],
            "kind": "error" if s["status"] == "error" else "missing",
            "reason": (s["error"] or "last backup errored") if s["status"] == "error"
            else f"{s['missing_count']} sample(s) missing",
        }
        for s in latest
        if s["status"] == "error" or s["missing_count"] > 0
    ]

    last = latest[0] if latest else None

    nas = {"reachable": False, "path": "", "free_bytes": 0, "total_bytes": 0}
    actual_size = 0
    if dest:
        dest_root = Path(dest) / "AbletonBackups"
        nas["path"] = str(dest_root)
        if Path(dest).is_dir():
            nas["reachable"] = True
            try:
                usage = shutil.disk_usage(dest)
                nas["free_bytes"] = usage.free
                nas["total_bytes"] = usage.total
            except OSError:
                pass
            actual_size = _pool_size(dest_root)

    logical_size = totals["logical_size"]
    return {
        "projects_protected": totals["projects_protected"],
        "snapshot_count": totals["snapshot_count"],
        "logical_size": logical_size,
        "actual_size": actual_size,
        "saved_bytes": max(0, logical_size - actual_size),
        "last_run": last["timestamp"] if last else None,
        "last_run_ok": bool(last) and last["status"] == "ok",
        "attention": attention,
        "nas": nas,
    }


def scan_summary(sources: list[Path]) -> list[dict]:
    """Scan sources and return JSON-serializable project summaries."""
    out = []
    for p in scan_projects([Path(s) for s in sources]):
        out.append({
            "name": p.name,
            "project_dir": str(p.project_dir),
            "als_path": str(p.als_path),
            "present_count": sum(1 for r in p.refs if r.exists),
            "missing_count": len(p.missing),
            "missing": [r.expected_path or r.name for r in p.missing],
            "total_size": p.total_size,
        })
    return out


def _emit(progress: ProgressCb, event: dict) -> None:
    if progress is not None:
        progress(event)


def run_backup(sources: list[Path], dest: Path, catalog: Catalog,
               timestamp: Optional[str] = None, progress: ProgressCb = None) -> dict:
    """Back up every discovered project to dest, recording history and emitting progress."""
    dest_root = Path(dest) / "AbletonBackups"
    timestamp = timestamp or default_timestamp()
    projects = scan_projects([Path(s) for s in sources])
    ok_count = 0
    error_count = 0
    _emit(progress, {"type": "backup_start", "project_count": len(projects),
                     "timestamp": timestamp})
    for i, p in enumerate(projects):
        _emit(progress, {"type": "project_start", "index": i,
                         "project_name": p.name, "total": len(projects)})
        try:
            result = backup_project(p, dest_root, timestamp)
        except Exception as e:  # isolate one project's failure from the rest
            catalog.record_snapshot(
                project_name=p.name, timestamp=timestamp, total_size=0,
                file_count=0, status="error", missing=[], error=str(e),
            )
            error_count += 1
            _emit(progress, {"type": "project_error", "index": i,
                             "project_name": p.name, "error": str(e)})
            continue
        catalog.record_snapshot(
            project_name=result.project_name, timestamp=result.timestamp,
            total_size=result.total_size, file_count=result.file_count,
            status="ok", missing=result.missing,
        )
        ok_count += 1
        _emit(progress, {"type": "project_done", "index": i,
                         "project_name": result.project_name,
                         "file_count": result.file_count,
                         "missing_count": len(result.missing)})
    _emit(progress, {"type": "backup_done", "ok_count": ok_count,
                     "error_count": error_count})
    return {"timestamp": timestamp, "ok_count": ok_count, "error_count": error_count}
