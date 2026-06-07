import hashlib
import os
import struct
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from typing import Callable, Optional
from xml.etree.ElementTree import ParseError

from ablebackup.daws.registry import DAW_REGISTRY, adapter_for_path
from ablebackup.models import FileRef, ProjectScan
from ablebackup.resolver import resolve_refs

# Kept for back-compat; discovery now uses each adapter's own skip_dirs.
SKIP_DIRS = {"Backup", "AbletonBackups"}

ProgressCb = Optional[Callable[[dict], None]]

# Parsing a project (gzip-decompress + walk a huge XML) is CPU bound in Python, so it
# doesn't parallelize across threads (the GIL). It DOES parallelize across processes:
# each worker parses an independent file and returns plain FileRef dataclasses. Resolve
# (filesystem stat) stays in the parent — it's cheap and needs the unpicklable locator.
_SCAN_WORKERS = min(8, (os.cpu_count() or 4))
# Below this many projects the pool's spin-up isn't worth it; parse inline instead.
_PARALLEL_THRESHOLD = 4


def project_id(project_path: Path) -> str:
    """A stable id for a project from its file location, so two projects that share
    a filename (e.g. two Untitled.als) never share identity or storage."""
    return hashlib.sha1(str(project_path.resolve()).encode("utf-8")).hexdigest()[:12]


def find_projects(roots: list[Path]) -> list[Path]:
    """Every supported DAW project file under the roots (cheap walk, no parsing)."""
    out: list[Path] = []
    paths = [Path(r) for r in roots]
    for adapter in DAW_REGISTRY:
        out.extend(adapter.discover_projects(paths))
    return out


def find_als(roots: list[Path]) -> list[Path]:
    """Back-compat: Ableton-only discovery."""
    from ablebackup.daws.ableton import AbletonAdapter
    return AbletonAdapter().discover_projects([Path(r) for r in roots])


def scan_one(project_path: Path, locate=None) -> ProjectScan:
    """Parse + resolve a single project (the expensive part of a scan), via the
    adapter that owns this file type."""
    project_path = Path(project_path)
    adapter = adapter_for_path(project_path)
    if adapter is None:
        raise ValueError(f"no DAW adapter for {project_path.suffix!r}")
    project_dir = project_path.parent
    stat = project_path.stat()
    refs = resolve_refs(adapter.parse_project(project_path), project_dir, locate=locate)
    return ProjectScan(
        project_path=project_path,
        name=adapter.project_name(project_path),
        project_dir=project_dir,
        mtime=stat.st_mtime,
        size=stat.st_size,
        daw_id=adapter.daw_id,
        project_id=project_id(project_path),
        refs=refs,
    )


def _parse_in_worker(project_path_str: str) -> Optional[list[FileRef]]:
    """Worker body for the process pool: parse one project to raw FileRefs.

    Returns None (rather than raising) for corrupt/unreadable/unsupported files, so a
    single bad project can't poison the pool — the parent treats None as "skip".
    Inputs/outputs are plain str / FileRef dataclasses so they pickle cleanly.
    """
    try:
        project_path = Path(project_path_str)
        adapter = adapter_for_path(project_path)
        if adapter is None:
            return None
        return adapter.parse_project(project_path)
    except (OSError, EOFError, ParseError, ValueError, struct.error):
        return None


def _resolve_parsed(project_path: Path, raw_refs: list[FileRef], locate) -> ProjectScan:
    """Finish a project the parser already produced raw refs for: resolve against the
    filesystem and assemble the ProjectScan. This is the cheap, parent-side half."""
    adapter = adapter_for_path(project_path)
    project_dir = project_path.parent
    stat = project_path.stat()
    refs = resolve_refs(raw_refs, project_dir, locate=locate)
    return ProjectScan(
        project_path=project_path,
        name=adapter.project_name(project_path),
        project_dir=project_dir,
        mtime=stat.st_mtime,
        size=stat.st_size,
        daw_id=adapter.daw_id,
        project_id=project_id(project_path),
        refs=refs,
    )


def _scan_safely(project_path: Path, locate) -> Optional[ProjectScan]:
    """scan_one but swallow per-file failures (serial path)."""
    try:
        return scan_one(project_path, locate=locate)
    except (OSError, EOFError, ParseError, ValueError, struct.error):
        return None


def scan_projects(roots: list[Path], progress: ProgressCb = None,
                  locate=None) -> list[ProjectScan]:
    """Discover and resolve every project under the roots (all DAWs).

    Counting project files up front lets us emit a real progress bar (scan_start/
    total, then a scan_progress tick per project) before the slow per-file parsing.

    Parsing (gzip + a huge XML walk) is CPU bound and is fanned out across a process
    pool — the dominant cost of a real-library scan, cut several-fold. Resolution
    (filesystem stat + the unpicklable locator) stays in this process. Results are
    returned in discovery order; progress ticks are emitted here as each project
    finishes, so `done` still climbs 1..total with the last tick at total.
    """
    project_files = find_projects(roots)
    total = len(project_files)
    if progress:
        progress({"type": "scan_start", "total": total})

    results: list[Optional[ProjectScan]] = [None] * total
    _was_ticked = [False] * total  # distinguishes "scanned, no result" from "not yet done"
    done = 0

    def _tick(idx: int, scan: Optional[ProjectScan]) -> None:
        nonlocal done
        results[idx] = scan
        _was_ticked[idx] = True
        done += 1
        if progress:
            name = scan.name if scan is not None else project_files[idx].stem
            progress({"type": "scan_progress", "done": done, "total": total, "name": name})

    pool = None
    if total >= _PARALLEL_THRESHOLD:
        try:
            pool = ProcessPoolExecutor(max_workers=_SCAN_WORKERS)
        except OSError:
            # Couldn't spawn workers (sandbox / ulimit) — fall back to serial so a
            # scan still works, just slower.
            pool = None
    if pool is not None:
        try:
            with pool:
                futures = {
                    pool.submit(_parse_in_worker, str(pf)): idx
                    for idx, pf in enumerate(project_files)
                }
                for fut in as_completed(futures):
                    idx = futures[fut]
                    raw = fut.result()
                    scan = None
                    if raw is not None:
                        try:
                            scan = _resolve_parsed(project_files[idx], raw, locate)
                        except (OSError, EOFError, ParseError, ValueError, struct.error):
                            scan = None
                    _tick(idx, scan)
        except BrokenProcessPool:
            # A worker died (e.g. OOM on a giant project). Don't abort the whole scan —
            # finish whatever's still unscanned serially. Already-ticked indices keep
            # their result; we only sweep the ones left as None.
            for idx, pf in enumerate(project_files):
                if not _was_ticked[idx]:
                    _tick(idx, _scan_safely(pf, locate))
    else:
        for idx, pf in enumerate(project_files):
            _tick(idx, _scan_safely(pf, locate))

    projects = [s for s in results if s is not None]  # discovery order, failures dropped
    if progress:
        progress({"type": "scan_done", "count": len(projects)})
    return projects
