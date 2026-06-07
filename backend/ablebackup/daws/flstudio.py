"""FL Studio adapter — uses the clean-room .flp reader (no PyFLP, no GPL).

FL doesn't record a per-sample size, so FileRef.size stays 0 and the resolver
falls back to its path-tail relink heuristic. An unreadable project raises and is
skipped by the scanner rather than crashing the whole scan.
"""
from pathlib import Path

from ablebackup.daws.base import walk_for_extensions
from ablebackup.daws.flp import read_sample_paths
from ablebackup.models import FileRef

SKIP_DIRS = {"Backup", "Backups", "AbletonBackups", "FLStudioBackups"}


class FlStudioAdapter:
    daw_id = "flstudio"
    display_name = "FL Studio"
    extensions = (".flp",)
    backup_root = "FLStudioBackups"

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return walk_for_extensions(roots, self.extensions, self.skip_dirs())

    def parse_project(self, project_path: Path) -> list[FileRef]:
        return [FileRef(name=Path(s).name, absolute_path=s)
                for s in read_sample_paths(project_path)]

    def project_name(self, project_path: Path) -> str:
        return project_path.stem

    def skip_dirs(self) -> set[str]:
        return set(SKIP_DIRS)

    def default_libraries(self) -> list[Path]:
        return []  # FL packs live alongside the install; no reliable shared library
