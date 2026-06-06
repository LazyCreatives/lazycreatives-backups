import os
from pathlib import Path
from xml.etree.ElementTree import ParseError

from ablebackup.als_parser import parse_als
from ablebackup.models import ProjectScan
from ablebackup.resolver import resolve_refs

SKIP_DIRS = {"Backup", "AbletonBackups"}


def scan_projects(roots: list[Path]) -> list[ProjectScan]:
    projects: list[ProjectScan] = []
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                if not fn.lower().endswith(".als"):
                    continue
                try:
                    als_path = Path(dirpath) / fn
                    project_dir = als_path.parent
                    stat = als_path.stat()
                    refs = resolve_refs(parse_als(als_path), project_dir)
                    projects.append(ProjectScan(
                        als_path=als_path,
                        name=als_path.stem,
                        project_dir=project_dir,
                        mtime=stat.st_mtime,
                        size=stat.st_size,
                        refs=refs,
                    ))
                except (OSError, EOFError, ParseError):
                    # Skip unreadable / corrupt .als (e.g. a partial file from an Ableton crash)
                    # rather than aborting the whole scan.
                    continue
    return projects
