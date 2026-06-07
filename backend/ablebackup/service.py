"""Orchestration layer: reusable scan/backup over the engine, with progress events."""
import hashlib
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from ablebackup.backup_engine import backup_project
from ablebackup.catalog import Catalog
from ablebackup.locator import default_libraries, make_locator
from ablebackup.models import ProjectScan
from ablebackup.scanner import scan_one, scan_projects

ProgressCb = Optional[Callable[[dict], None]]


def _build_locator(sources, libraries):
    """A name->path locator over the user's libraries (default: Splice) + sources."""
    roots = [Path(lib) for lib in (libraries or [])] or default_libraries()
    roots += [Path(s) for s in sources]
    return make_locator(roots)


def default_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H%M")


def project_signature(scan: ProjectScan) -> str:
    """A content fingerprint of a project: its .als plus every present sample's
    size + mtime. Unchanged project => same signature => no new snapshot."""
    h = hashlib.sha1()
    h.update(f"{scan.size}:{int(scan.mtime)}".encode())
    for path, size, mtime in sorted(
        (str(r.resolved_path), r.size, int(r.mtime)) for r in scan.refs if r.exists
    ):
        h.update(f"|{path}:{size}:{mtime}".encode())
    return h.hexdigest()


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


def scan_summary(sources: list[Path], progress: ProgressCb = None,
                 find_missing: bool = False, libraries=None) -> list[dict]:
    """Scan sources and return JSON-serializable project summaries.

    When progress is given, emits scan_start/scan_progress/scan_done events so the
    UI can show live scan progress instead of an indefinite spinner. When
    find_missing is set, samples missing from their referenced path are searched
    for (by filename) in the user's libraries + sources and relinked when found.
    """
    locate = _build_locator(sources, libraries) if find_missing else None
    out = []
    for p in scan_projects([Path(s) for s in sources], progress=progress, locate=locate):
        out.append({
            "name": p.name,
            "project_dir": str(p.project_dir),
            "als_path": str(p.als_path),
            "present_count": sum(1 for r in p.refs if r.exists),
            "relinked_count": sum(1 for r in p.refs if r.exists and r.relinked),
            "missing_count": len(p.missing),
            "missing": [r.expected_path or r.name for r in p.missing],
            "total_size": p.total_size,
        })
    return out


def _emit(progress: ProgressCb, event: dict) -> None:
    if progress is not None:
        progress(event)


def run_backup(sources: list[Path], dest: Path, catalog: Catalog,
               timestamp: Optional[str] = None, progress: ProgressCb = None,
               als_paths: Optional[list[str]] = None, label: Optional[str] = None,
               portable: bool = False, layout: str = "project_date",
               find_missing: bool = False, libraries=None) -> dict:
    """Back up discovered projects to dest, recording history and emitting progress.

    When als_paths is given, only the projects whose .als matches are backed up
    (the user's include/exclude selection); otherwise every discovered project.
    label/portable/layout are the user's per-run choices from the review step.
    """
    dest_root = Path(dest) / "AbletonBackups"
    timestamp = timestamp or default_timestamp()
    # Tell the UI we've started straight away — resolving projects can take a moment,
    # and a silent gap looks like nothing is happening.
    _emit(progress, {"type": "backup_preparing"})
    locate = _build_locator(sources, libraries) if find_missing else None
    if als_paths is not None:
        # Scan only the chosen projects (fast) rather than re-walking every source.
        projects = [scan_one(Path(a), locate=locate) for a in als_paths if Path(a).exists()]
    else:
        projects = scan_projects([Path(s) for s in sources], locate=locate)

    last_sigs = catalog.latest_signatures()
    ok_count = 0
    error_count = 0
    skipped_count = 0
    _emit(progress, {"type": "backup_start", "project_count": len(projects),
                     "timestamp": timestamp})
    for i, p in enumerate(projects):
        _emit(progress, {"type": "project_start", "index": i,
                         "project_name": p.name, "total": len(projects)})
        signature = project_signature(p)
        if last_sigs.get(p.name) == signature:
            # Identical to the last successful backup — don't make a redundant snapshot.
            skipped_count += 1
            _emit(progress, {"type": "project_skipped", "index": i, "project_name": p.name})
            continue
        try:
            result = backup_project(p, dest_root, timestamp, portable=portable, layout=layout)
        except Exception as e:  # isolate one project's failure from the rest
            catalog.record_snapshot(
                project_name=p.name, timestamp=timestamp, total_size=0,
                file_count=0, status="error", missing=[], error=str(e), label=label,
            )
            error_count += 1
            _emit(progress, {"type": "project_error", "index": i,
                             "project_name": p.name, "error": str(e)})
            continue
        catalog.record_snapshot(
            project_name=result.project_name, timestamp=result.timestamp,
            total_size=result.total_size, file_count=result.file_count,
            status="ok", missing=result.missing, label=label,
            dir=str(result.snapshot_dir), signature=signature,
        )
        ok_count += 1
        _emit(progress, {"type": "project_done", "index": i,
                         "project_name": result.project_name,
                         "file_count": result.file_count,
                         "missing_count": len(result.missing)})
    _emit(progress, {"type": "backup_done", "skipped_count": skipped_count,
                     "ok_count": ok_count,
                     "error_count": error_count})
    return {"timestamp": timestamp, "ok_count": ok_count,
            "error_count": error_count, "skipped_count": skipped_count}
