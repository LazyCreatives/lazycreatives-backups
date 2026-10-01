"""The DAW adapter interface. One adapter per DAW; the rest of the pipeline is neutral."""
import os
from pathlib import Path
from typing import Iterable, Protocol

from ablebackup.models import FileRef

# Every DAW's destination subfolder — scanners skip these so a scan of the dest
# (or a source that overlaps it) never descends into prior backups.
BACKUP_ROOTS = {"AbletonBackups", "FLStudioBackups", "ReaperBackups", "DAWprojectBackups"}
COMMON_SKIP = {"Backup", "Backups"} | BACKUP_ROOTS


class DawAdapter(Protocol):
    daw_id: str                      # 'ableton' | 'flstudio' — stored in catalog + manifest
    display_name: str                # 'Ableton Live'
    extensions: tuple[str, ...]      # ('.als',) — drives discovery AND parse dispatch
    backup_root: str                 # per-DAW destination subfolder ('AbletonBackups')

    def discover_projects(self, roots: list[Path]) -> Iterable[Path]: ...
    def parse_project(self, project_path: Path) -> list[FileRef]: ...
    def project_name(self, project_path: Path) -> str: ...
    def skip_dirs(self) -> set[str]: ...
    def default_libraries(self) -> list[Path]: ...


def walk_for_extensions(roots: list[Path], extensions: tuple[str, ...],
                        skip_dirs: set[str]) -> list[Path]:
    """Shared project-file discovery: one os.walk per root, matched by extension."""
    out: list[Path] = []
    exts = tuple(e.lower() for e in extensions)
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in skip_dirs]
            for fn in filenames:
                if fn.lower().endswith(exts):
                    out.append(Path(dirpath) / fn)
    return out
