import hashlib
import os
from pathlib import Path
from typing import Callable, Optional
from xml.etree.ElementTree import ParseError

from ablebackup.als_parser import parse_als
from ablebackup.models import ProjectScan
from ablebackup.resolver import resolve_refs

SKIP_DIRS = {"Backup", "AbletonBackups"}

ProgressCb = Optional[Callable[[dict], None]]


def project_id(als_path: Path) -> str:
    """A stable id for a project from its .als location, so two projects that
    share a filename (e.g. two Untitled.als) never share identity or storage."""
    return hashlib.sha1(str(als_path.resolve()).encode("utf-8")).hexdigest()[:12]


def find_als(roots: list[Path]) -> list[Path]:
    """All .als files under the roots (cheap walk, no parsing), skipping backup dirs."""
    out: list[Path] = []
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                if fn.lower().endswith(".als"):
                    out.append(Path(dirpath) / fn)
    return out


def scan_one(als_path: Path, locate=None) -> ProjectScan:
    """Parse + resolve a single project (the expensive part of a scan)."""
    project_dir = als_path.parent
    stat = als_path.stat()
    refs = resolve_refs(parse_als(als_path), project_dir, locate=locate)
    return ProjectScan(
        als_path=als_path,
        name=als_path.stem,
        project_dir=project_dir,
        mtime=stat.st_mtime,
        size=stat.st_size,
        project_id=project_id(als_path),
        refs=refs,
    )


def scan_projects(roots: list[Path], progress: ProgressCb = None,
                  locate=None) -> list[ProjectScan]:
    """Discover and resolve every project under the roots.

    Counting the .als up front lets us emit a real progress bar (scan_start/total,
    then a scan_progress tick per project) before the slow per-file parsing.
    """
    als_files = find_als(roots)
    total = len(als_files)
    if progress:
        progress({"type": "scan_start", "total": total})
    projects: list[ProjectScan] = []
    for i, als_path in enumerate(als_files):
        name = als_path.stem
        try:
            scan = scan_one(als_path, locate=locate)
            projects.append(scan)
            name = scan.name
        except (OSError, EOFError, ParseError):
            # Skip unreadable / corrupt .als (e.g. a partial file from an Ableton crash)
            # rather than aborting the whole scan.
            pass
        if progress:
            progress({"type": "scan_progress", "done": i + 1, "total": total, "name": name})
    if progress:
        progress({"type": "scan_done", "count": len(projects)})
    return projects
