"""Ableton Live adapter — wraps the existing .als parser/discovery verbatim."""
from pathlib import Path

from ablebackup.als_parser import parse_als
from ablebackup.daws.base import walk_for_extensions
from ablebackup.locator import default_libraries as _splice_libraries
from ablebackup.models import FileRef

SKIP_DIRS = {"Backup", "Backups", "AbletonBackups", "FLStudioBackups"}


class AbletonAdapter:
    daw_id = "ableton"
    display_name = "Ableton Live"
    extensions = (".als",)
    backup_root = "AbletonBackups"  # per-DAW destination subfolder

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return walk_for_extensions(roots, self.extensions, self.skip_dirs())

    def parse_project(self, project_path: Path) -> list[FileRef]:
        return parse_als(project_path)

    def project_name(self, project_path: Path) -> str:
        return project_path.stem

    def skip_dirs(self) -> set[str]:
        return set(SKIP_DIRS)

    def default_libraries(self) -> list[Path]:
        # Splice is where Ableton users' downloaded samples live.
        return _splice_libraries()
