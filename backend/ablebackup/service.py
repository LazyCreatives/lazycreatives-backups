"""Orchestration layer: reusable scan/backup over the engine, with progress events."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from ablebackup.backup_engine import backup_project
from ablebackup.catalog import Catalog
from ablebackup.daws.registry import DAW_REGISTRY, adapter_for_id
from ablebackup.hashing import hash_file
from ablebackup.locator import default_libraries, make_locator
from ablebackup.models import ProjectScan
from ablebackup.scanner import scan_one, scan_projects
from ablebackup.verifier import verify_snapshot

ProgressCb = Optional[Callable[[dict], None]]


def _build_locator(sources, libraries):
    """A name->path locator over the user's libraries (default: Splice) + sources."""
    roots = [Path(lib) for lib in (libraries or [])] or default_libraries()
    roots += [Path(s) for s in sources]
    return make_locator(roots)


def default_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H%M")


def project_signature(scan: ProjectScan) -> str:
    """A content fingerprint of a project. Ableton rewrites the .als on every save,
    so we hash its actual content (robust to a same-size/same-second edit) plus each
    present sample's size + mtime. Unchanged => same signature => no new snapshot."""
    h = hashlib.sha1()
    try:
        h.update(hash_file(scan.als_path).encode())
    except OSError:
        h.update(f"{scan.size}:{int(scan.mtime)}".encode())  # fall back if unreadable
    for path, size, mtime in sorted(
        (str(r.resolved_path), r.size, int(r.mtime)) for r in scan.refs if r.exists
    ):
        h.update(f"|{path}:{size}:{mtime}".encode())
    return h.hexdigest()


def _is_rclone_remote(dest: str) -> bool:
    """An offsite target is an rclone remote (e.g. s3:bucket/path, gdrive:Backups)
    rather than a local folder. Local POSIX paths start with '/'."""
    if dest.startswith("rclone:"):
        return True
    return not os.path.isabs(dest) and bool(re.match(r"^[\w-]+:", dest))


def rclone_available() -> bool:
    return shutil.which("rclone") is not None


def rclone_remotes() -> list[str]:
    """Configured rclone remote names (without the trailing ':'), or [] if none."""
    if not rclone_available():
        return []
    try:
        out = subprocess.run(["rclone", "listremotes"], capture_output=True, text=True, timeout=10)
        return [r.rstrip(":") for r in out.stdout.split() if r.strip()]
    except (OSError, subprocess.SubprocessError):
        return []


def _rclone_copy(src: Path, remote_dest: str) -> bool:
    try:
        r = subprocess.run(["rclone", "copy", str(src), remote_dest, "--quiet"],
                           capture_output=True, text=True, timeout=3600)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def mirror_snapshot(snapshot_dir: Path, base: Path, mirrors: list) -> int:
    """Copy a freshly-written snapshot to each offsite/cloud destination as a
    standalone copy. A mirror may be a local/sync folder OR an rclone remote
    (s3:, b2:, gdrive:, …). Best-effort: a mirror failure never fails the primary
    backup. Returns how many mirrors received it."""
    done = 0
    try:
        rel = Path(snapshot_dir).resolve().relative_to(Path(base).resolve())
    except ValueError:
        return 0
    for m in mirrors:
        try:
            if _is_rclone_remote(m):
                remote = m[len("rclone:"):] if m.startswith("rclone:") else m
                if _rclone_copy(snapshot_dir, f"{remote.rstrip('/')}/{rel.as_posix()}"):
                    done += 1
            else:
                target = Path(m) / rel
                if target.exists():
                    done += 1
                else:
                    shutil.copytree(snapshot_dir, target)
                    done += 1
        except OSError:
            pass  # offsite is best-effort (drive unplugged, cloud folder busy, …)
    return done


def _manifest_files(snapshot_dir) -> dict | None:
    """logical_path -> file entry for a snapshot's manifest, or None if unreadable."""
    if not snapshot_dir:
        return None
    mf = Path(snapshot_dir) / "manifest.json"
    if not mf.is_file():
        return None
    try:
        return {f["logical_path"]: f for f in json.loads(mf.read_text()).get("files", [])}
    except (OSError, ValueError, KeyError):
        return None


def snapshot_diff(new_dir, old_dir) -> dict:
    """What changed between two snapshots, by comparing per-file content digests."""
    new = _manifest_files(new_dir)
    if new is None:
        return {"available": False, "added": [], "removed": [], "changed": [], "unchanged": 0}
    old = _manifest_files(old_dir) or {}
    added = sorted(p for p in new if p not in old)
    removed = sorted(p for p in old if p not in new)
    changed = sorted(p for p in new if p in old and new[p].get("digest") != old[p].get("digest"))
    unchanged = sum(1 for p in new if p in old and new[p].get("digest") == old[p].get("digest"))
    return {"available": True, "added": added, "removed": removed, "changed": changed, "unchanged": unchanged}


def restore_snapshot(snapshot_dir, target_dir) -> str:
    """Copy a snapshot back out to target_dir as a standalone, openable project.

    Hardlinks into the pool become real byte copies, and our internal files
    (manifest.json, .abid) are left out, so the restored folder is a clean project.
    """
    import json

    src = Path(snapshot_dir)
    if not src.is_dir():
        raise FileNotFoundError(f"snapshot folder not found: {src}")
    manifest = {}
    mf = src / "manifest.json"
    if mf.is_file():
        try:
            manifest = json.loads(mf.read_text())
        except (OSError, ValueError):
            pass
    name = manifest.get("project_name") or src.name
    ts = manifest.get("timestamp") or ""
    folder_name = f"{name} ({ts})" if ts else name
    dst = Path(target_dir) / folder_name
    n = 1
    while dst.exists():
        dst = Path(target_dir) / f"{folder_name} ({n})"
        n += 1
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("manifest.json", ".abid"))
    return str(dst)


def share_snapshot(snapshot_dir, target_dir) -> str:
    """Zip a snapshot into a single sendable file. A portable snapshot zips into a
    complete, self-contained project a collaborator can open straight away."""
    import zipfile

    src = Path(snapshot_dir)
    if not src.is_dir():
        raise FileNotFoundError(f"snapshot folder not found: {src}")
    manifest = _manifest_meta(src)
    name = manifest.get("project_name") or src.name
    ts = manifest.get("timestamp") or ""
    base = f"{name} ({ts})" if ts else name
    zip_path = Path(target_dir) / f"{base}.zip"
    n = 1
    while zip_path.exists():
        zip_path = Path(target_dir) / f"{base} ({n}).zip"
        n += 1
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in src.rglob("*"):
            if f.is_file() and f.name not in ("manifest.json", ".abid"):
                z.write(f, str(Path(base) / f.relative_to(src)))
    return str(zip_path)


def _manifest_meta(src: Path) -> dict:
    mf = src / "manifest.json"
    if mf.is_file():
        try:
            return json.loads(mf.read_text())
        except (OSError, ValueError):
            pass
    return {}


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


def refresh_pool_cache(catalog: Catalog, dest: str) -> int:
    """Walk the dedup pool (slow over a NAS) and cache the total, so the dashboard
    can read it instantly. Called in the background after backups and when stale."""
    if not dest or not Path(dest).is_dir():
        return 0
    total = sum(_pool_size(Path(dest) / a.backup_root) for a in DAW_REGISTRY)
    catalog.set_setting("pool_cache", {"actual_size": total, "at": time.time()})
    return total


def pool_cache_age(catalog: Catalog) -> Optional[float]:
    """Seconds since the pool size was last computed, or None if never."""
    cache = catalog.get_setting("pool_cache") or {}
    return time.time() - cache["at"] if "at" in cache else None


def build_overview(catalog: Catalog, dest: str) -> dict:
    """A health snapshot for the dashboard: totals, dedup savings, NAS status, attention.

    The pool size is read from cache (refresh_pool_cache populates it in the
    background) — walking the pool on every load made the NAS dashboard take ~15s.
    """
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
    if dest:
        nas["path"] = str(dest)
        if Path(dest).is_dir():
            nas["reachable"] = True
            try:
                usage = shutil.disk_usage(dest)  # one statvfs — fast
                nas["free_bytes"] = usage.free
                nas["total_bytes"] = usage.total
            except OSError:
                pass

    cache = catalog.get_setting("pool_cache") or {}
    pool_known = "actual_size" in cache
    actual_size = int(cache.get("actual_size", 0))

    logical_size = totals["logical_size"]
    return {
        "projects_protected": totals["projects_protected"],
        "snapshot_count": totals["snapshot_count"],
        "logical_size": logical_size,
        "actual_size": actual_size,
        "saved_bytes": max(0, logical_size - actual_size) if pool_known else 0,
        "pool_known": pool_known,  # false until the first background walk finishes
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
            "daw": p.daw_id,
            "project_dir": str(p.project_dir),
            "als_path": str(p.project_path),
            "present_count": sum(1 for r in p.refs if r.exists),
            "relinked_count": sum(1 for r in p.refs if r.exists and r.relinked),
            "missing_count": len(p.missing),
            "missing": [r.expected_path or r.name for r in p.missing],
            "total_size": p.total_size,
            "mtime": p.mtime,  # for "recently modified" sorting in the UI
        })
    return out


def _emit(progress: ProgressCb, event: dict) -> None:
    if progress is not None:
        progress(event)


_backup_lock = threading.Lock()


def backup_in_progress() -> bool:
    """True while any backup is running — lets the scheduler skip overlapping ticks."""
    return _backup_lock.locked()


def run_backup(sources: list[Path], dest: Path, catalog: Catalog,
               timestamp: Optional[str] = None, progress: ProgressCb = None,
               als_paths: Optional[list[str]] = None, label: Optional[str] = None,
               portable: bool = False, layout: str = "project_date",
               find_missing: bool = False, libraries=None, should_cancel=None,
               mirrors=None) -> dict:
    """Serialize all backups process-wide, then run one.

    Only one backup may run at a time (manual or scheduled), so two runs can't race
    on the same snapshot folder and corrupt/lose it (audit: scheduler-vs-manual
    overlap). The actual work is in _run_backup_locked.
    """
    with _backup_lock:
        return _run_backup_locked(
            sources, dest, catalog, timestamp, progress, als_paths, label,
            portable, layout, find_missing, libraries, should_cancel, mirrors)


def _run_backup_locked(sources: list[Path], dest: Path, catalog: Catalog,
                       timestamp: Optional[str] = None, progress: ProgressCb = None,
                       als_paths: Optional[list[str]] = None, label: Optional[str] = None,
                       portable: bool = False, layout: str = "project_date",
                       find_missing: bool = False, libraries=None, should_cancel=None,
                       mirrors=None) -> dict:
    """Back up discovered projects to dest, recording history and emitting progress.

    When als_paths is given, only the projects whose .als matches are backed up
    (the user's include/exclude selection); otherwise every discovered project.
    label/portable/layout are the user's per-run choices from the review step.
    """
    base = Path(dest)
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
    cancelled = False
    _emit(progress, {"type": "backup_start", "project_count": len(projects),
                     "timestamp": timestamp})
    for i, p in enumerate(projects):
        if should_cancel and should_cancel():
            cancelled = True
            break
        _emit(progress, {"type": "project_start", "index": i,
                         "project_name": p.name, "total": len(projects)})
        signature = project_signature(p)
        if last_sigs.get(p.project_id) == signature:
            # Identical to the last successful backup — don't make a redundant snapshot.
            skipped_count += 1
            _emit(progress, {"type": "project_skipped", "index": i, "project_name": p.name})
            continue
        # Per-DAW destination root, so FL and Ableton backups stay separate.
        adapter = adapter_for_id(p.daw_id)
        dest_root = base / (adapter.backup_root if adapter else "AbletonBackups")
        try:
            result = backup_project(p, dest_root, timestamp, portable=portable, layout=layout)
        except Exception as e:  # isolate one project's failure from the rest
            catalog.record_snapshot(
                project_name=p.name, timestamp=timestamp, total_size=0,
                file_count=0, status="error", missing=[], error=str(e), label=label,
                project_id=p.project_id, daw=p.daw_id,
            )
            error_count += 1
            _emit(progress, {"type": "project_error", "index": i,
                             "project_name": p.name, "error": str(e)})
            continue
        # Re-read the snapshot we just wrote to confirm every file actually landed
        # at the right size (catches truncated/failed writes, esp. over a NAS).
        v = verify_snapshot(result.snapshot_dir, deep=False)
        if not v["ok"]:
            status = "error"
            verr = v["error"] or f"{len(v['missing_files'])} missing, {len(v['bad_files'])} bad"
        else:
            status = "partial" if result.missing else "ok"
            verr = None
        catalog.record_snapshot(
            project_name=result.project_name, timestamp=result.timestamp,
            total_size=result.total_size, file_count=result.file_count,
            status=status, missing=result.missing, error=verr, label=label,
            dir=str(result.snapshot_dir), signature=signature,
            relinked_count=result.relinked_count,
            verified=1 if v["ok"] else 0, verified_at=timestamp,
            project_id=p.project_id, daw=p.daw_id,
        )
        ok_count += 1
        if mirrors:  # also copy this snapshot offsite (cloud/2nd drive) — best-effort
            mirror_snapshot(result.snapshot_dir, base, [str(m) for m in mirrors])
        _emit(progress, {"type": "project_done", "index": i,
                         "project_name": result.project_name,
                         "file_count": result.file_count,
                         "missing_count": len(result.missing)})
    _emit(progress, {"type": "backup_done", "skipped_count": skipped_count,
                     "ok_count": ok_count, "error_count": error_count,
                     "cancelled": cancelled})
    return {"timestamp": timestamp, "ok_count": ok_count,
            "error_count": error_count, "skipped_count": skipped_count,
            "cancelled": cancelled}
