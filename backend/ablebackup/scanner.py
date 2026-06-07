import hashlib
from pathlib import Path
from typing import Callable, Optional
from xml.etree.ElementTree import ParseError

from ablebackup.daws.registry import DAW_REGISTRY, adapter_for_path
from ablebackup.models import ProjectScan
from ablebackup.resolver import resolve_refs

# Kept for back-compat; discovery now uses each adapter's own skip_dirs.
SKIP_DIRS = {"Backup", "AbletonBackups"}

ProgressCb = Optional[Callable[[dict], None]]


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


def scan_projects(roots: list[Path], progress: ProgressCb = None,
                  locate=None) -> list[ProjectScan]:
    """Discover and resolve every project under the roots (all DAWs).

    Counting project files up front lets us emit a real progress bar (scan_start/
    total, then a scan_progress tick per project) before the slow per-file parsing.
    """
    project_files = find_projects(roots)
    total = len(project_files)
    if progress:
        progress({"type": "scan_start", "total": total})
    projects: list[ProjectScan] = []
    for i, project_path in enumerate(project_files):
        name = project_path.stem
        try:
            scan = scan_one(project_path, locate=locate)
            projects.append(scan)
            name = scan.name
        except (OSError, EOFError, ParseError, ValueError):
            # Skip unreadable / corrupt / unsupported project files rather than
            # aborting the whole scan.
            pass
        if progress:
            progress({"type": "scan_progress", "done": i + 1, "total": total, "name": name})
    if progress:
        progress({"type": "scan_done", "count": len(projects)})
    return projects
