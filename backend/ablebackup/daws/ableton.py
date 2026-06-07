"""Ableton Live adapter — wraps the existing .als parser/discovery verbatim."""
import gzip
import xml.etree.ElementTree as _ET
from pathlib import Path
from typing import Optional

import defusedxml.ElementTree as ET

from ablebackup.als_parser import _fileref_to_model, parse_als
from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.locator import default_libraries as _splice_libraries
from ablebackup.models import FileRef
from ablebackup.resolver import _candidates, _is_inside

SKIP_DIRS = COMMON_SKIP


def _set_value(parent, tag: str, value: str) -> None:
    child = parent.find(tag)
    if child is None:
        child = _ET.SubElement(parent, tag)
    child.set("Value", value)


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

    def rewrite_portable(self, project_path: Path) -> Optional[bytes]:
        """Return a gzipped .als where every EXTERNAL sample now points at its
        collected copy inside the snapshot (_External/<name>), so the project
        opens on any machine. Returns None if there's nothing external to rewrite.
        Mirrors backup_engine._logical_path (external -> _External/<basename>)."""
        project_dir = Path(project_path).parent
        with gzip.open(project_path, "rt", encoding="utf-8") as fh:
            root = ET.parse(fh).getroot()
        changed = False
        for sample_ref in root.iter("SampleRef"):
            fr = sample_ref.find("FileRef")
            if fr is None:
                continue
            model = _fileref_to_model(fr)
            chosen = next((c for c in _candidates(model, project_dir) if c.is_file()), None)
            if chosen is None or _is_inside(chosen, project_dir):
                continue  # missing or already inside the project — leave it
            _set_value(fr, "RelativePath", f"_External/{chosen.name}")
            _set_value(fr, "RelativePathType", "1")  # relative to the project folder
            _set_value(fr, "Path", "")               # don't try the original absolute path
            changed = True
        if not changed:
            return None
        xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + _ET.tostring(root, encoding="unicode")
        return gzip.compress(xml.encode("utf-8"))
