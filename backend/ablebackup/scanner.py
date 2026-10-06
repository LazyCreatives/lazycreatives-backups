import hashlib
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from typing import Callable, Optional

from ablebackup.daws.base import empty_meta, parse_with_meta
from ablebackup.daws.registry import (DAW_REGISTRY, adapter_for_path, ignored_file,
                                      package_extensions)
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


def find_projects_progress(roots: list[Path], progress: ProgressCb = None,
                           stats: Optional[dict] = None) -> list[Path]:
    """Like find_projects but as a SINGLE walk over the roots (matching every DAW's
    extensions at once, instead of one walk per adapter), emitting periodic
    `scan_searching` ticks (folders seen, projects found). This gives a live search
    phase for big/whole-Mac scans — otherwise the walk is a dead spinner — and is
    faster (one traversal, not N).

    Permission-denied directories (other accounts' 0700 homes, TCC-protected folders
    without Full Disk Access) are COUNTED via os.walk(onerror=...) instead of being
    silently swallowed, so the caller can tell the user the scan was incomplete and
    offer an elevated scan — otherwise a users/entire scan finishes fast with nothing
    new and looks broken. If `stats` is given it gets {skipped_dirs, skipped_examples}."""
    from ablebackup.daws.base import _keep_dirs
    pkg_exts = package_extensions()
    exts = tuple(sorted({e.lower() for a in DAW_REGISTRY for e in a.extensions} - set(pkg_exts)))
    skip: set[str] = set()
    for a in DAW_REGISTRY:
        skip |= a.skip_dirs()
    out: list[Path] = []
    dirs_seen = 0
    skipped = 0
    denied: list[str] = []

    def _on_err(err: OSError) -> None:
        nonlocal skipped
        skipped += 1
        fn = getattr(err, "filename", None)
        if fn and len(denied) < 10 and str(fn) not in denied:
            denied.append(str(fn))

    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root, onerror=_on_err):
            # Folder projects (Logic's .logicx packages) count as one project each
            # and are never walked into.
            pkgs = [d for d in dirnames if d.lower().endswith(pkg_exts)] if pkg_exts else []
            out.extend(Path(dirpath) / d for d in pkgs)
            dirnames[:] = _keep_dirs([d for d in dirnames if d not in pkgs], skip)
            dirs_seen += 1
            for fn in filenames:
                if fn.lower().endswith(exts) and not ignored_file(Path(dirpath) / fn):
                    out.append(Path(dirpath) / fn)
            if progress and dirs_seen % 250 == 0:
                progress({"type": "scan_searching", "dirs": dirs_seen,
                          "found": len(out), "skipped": skipped})
    if stats is not None:
        stats["skipped_dirs"] = skipped
        stats["skipped_examples"] = denied
    if progress:
        progress({"type": "scan_searching", "dirs": dirs_seen,
                  "found": len(out), "skipped": skipped})
    return out


# Anything a broken or unusual project file can make a parser throw. A scan skips that one
# project and carries on; it must never stop the whole scan (KeyError, IndexError, zlib
# errors and friends included, not only the expected read errors).
_BAD_FILE = (Exception,)


def _parse_safely(adapter, project_path: Path) -> tuple[list[FileRef], dict]:
    """The adapter's refs + display metadata in one read. Metadata is best-effort —
    a meta-side failure must never cost us the refs (backups beat badges)."""
    try:
        return parse_with_meta(adapter, project_path)
    except _BAD_FILE:
        # Retry refs alone: if this also fails, the project is genuinely unreadable
        # and the caller's except will skip it as before.
        return adapter.parse_project(project_path), empty_meta()


def scan_one(project_path: Path, locate=None, overrides=None) -> ProjectScan:
    """Parse + resolve a single project (the expensive part of a scan), via the
    adapter that owns this file type. `overrides` lets the caller hand-map specific
    missing samples to exact files the user pointed at (see resolve_refs)."""
    project_path = Path(project_path)
    adapter = adapter_for_path(project_path)
    if adapter is None:
        raise ValueError(f"no DAW adapter for {project_path.suffix!r}")
    raw_refs, meta = _parse_safely(adapter, project_path)
    return _resolve_parsed(project_path, raw_refs, locate, meta, overrides)


def _parse_in_worker(project_path_str: str) -> Optional[dict]:
    """Worker body for the process pool: parse one project to raw FileRefs + display
    metadata (tempo/tracks/plugins) in the same read — parallel, so metadata never
    adds a serial pass in the parent.

    Returns None (rather than raising) for corrupt/unreadable/unsupported files, so a
    single bad project can't poison the pool — the parent treats None as "skip".
    Returns plain dict/FileRefs so it pickles cleanly.
    """
    try:
        project_path = Path(project_path_str)
        adapter = adapter_for_path(project_path)
        if adapter is None:
            return None
        raw_refs, meta = _parse_safely(adapter, project_path)
        return {"refs": raw_refs, "meta": meta}
    except _BAD_FILE:
        return None


def _resolve_parsed(project_path: Path, raw_refs: list[FileRef], locate,
                    meta: Optional[dict] = None, overrides=None) -> ProjectScan:
    """Finish a project the parser already produced raw refs for: resolve against the
    filesystem and assemble the ProjectScan. This is the cheap, parent-side half."""
    adapter = adapter_for_path(project_path)
    project_dir = project_path.parent
    stat = project_path.stat()
    refs = resolve_refs(raw_refs, project_dir, locate=locate, overrides=overrides)
    meta = meta or empty_meta()
    mtime, size = stat.st_mtime, stat.st_size
    if project_path.is_dir():
        # A folder project (Logic package): its files are refs (counted there), and
        # it was last saved when the newest file inside it changed.
        size = 0
        inner = [r.mtime for r in refs if r.exists and r.resolved_path is not None
                 and project_path in r.resolved_path.parents]
        mtime = max(inner, default=mtime)
    return ProjectScan(
        project_path=project_path,
        name=adapter.project_name(project_path),
        project_dir=project_dir,
        mtime=mtime,
        size=size,
        daw_id=adapter.daw_id,
        project_id=project_id(project_path),
        refs=refs,
        tempo=meta.get("tempo"),
        track_count=meta.get("tracks"),
        plugins=meta.get("plugins") or [],
    )


def _scan_safely(project_path: Path, locate, overrides=None) -> Optional[ProjectScan]:
    """scan_one but swallow per-file failures (serial path)."""
    try:
        return scan_one(project_path, locate=locate, overrides=overrides)
    except _BAD_FILE:
        return None


def scan_projects(roots: list[Path], progress: ProgressCb = None,
                  locate=None, stats: Optional[dict] = None,
                  pointed: Optional[dict] = None) -> list[ProjectScan]:
    """Discover and resolve every project under the roots (all DAWs).

    Counting project files up front lets us emit a real progress bar (scan_start/
    total, then a scan_progress tick per project) before the slow per-file parsing.

    Parsing (gzip + a huge XML walk) is CPU bound and is fanned out across a process
    pool — the dominant cost of a real-library scan, cut several-fold. Resolution
    (filesystem stat + the unpicklable locator) stays in this process. Results are
    returned in discovery order; progress ticks are emitted here as each project
    finishes, so `done` still climbs 1..total with the last tick at total.

    `pointed` ({project file: {expected path: chosen file}}) carries the files the
    producer pointed at for missing samples, so those count as found.
    """
    pointed = pointed or {}
    # With progress (or a stats request), walk once with live ticks + skip counting;
    # without either (plain tests), the simple walk.
    if progress is not None or stats is not None:
        project_files = find_projects_progress(roots, progress, stats)
    else:
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
                    try:
                        raw = fut.result()
                    except BrokenProcessPool:
                        raise
                    except _BAD_FILE:
                        raw = None
                    scan = None
                    if raw is not None:
                        try:
                            scan = _resolve_parsed(project_files[idx], raw["refs"], locate, raw.get("meta"),
                                                   pointed.get(str(project_files[idx])))
                        except _BAD_FILE:
                            scan = None
                    _tick(idx, scan)
        except BrokenProcessPool:
            # A worker died (e.g. OOM on a giant project). Don't abort the whole scan —
            # finish whatever's still unscanned serially. Already-ticked indices keep
            # their result; we only sweep the ones left as None.
            for idx, pf in enumerate(project_files):
                if not _was_ticked[idx]:
                    _tick(idx, _scan_safely(pf, locate, pointed.get(str(pf))))
    else:
        for idx, pf in enumerate(project_files):
            _tick(idx, _scan_safely(pf, locate, pointed.get(str(pf))))

    projects = [s for s in results if s is not None]  # discovery order, failures dropped
    if progress:
        progress({"type": "scan_done", "count": len(projects)})
    return projects
