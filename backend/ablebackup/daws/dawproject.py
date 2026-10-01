"""DAWproject adapter — the open, documented format (zip + XML) that Bitwig and
Studio One can both export. One adapter, two DAWs.

The .dawproject is a single zip: we back up the file as-is (embedded media rides
along inside it) and follow only EXTERNAL referenced samples — detected as
<… path="…"> entries that are not members of the zip.
"""
import os
import zipfile
from pathlib import Path

import defusedxml.ElementTree as ET

from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.models import FileRef

_AUDIO_EXTS = (".wav", ".aif", ".aiff", ".flac", ".mp3", ".ogg", ".m4a", ".wv", ".aac")


# A .dawproject is attacker-supplyable (it's exactly what 'share' exchanges), so
# guard the project.xml member against a decompression bomb before reading it.
_MAX_XML_BYTES = 64 * 1024 * 1024
_MAX_XML_RATIO = 200


def read_sample_paths(dawproject_path) -> list[str]:
    """External audio paths referenced by a .dawproject (embedded media excluded)."""
    with zipfile.ZipFile(dawproject_path) as z:
        members = set(z.namelist())
        xml_name = ("project.xml" if "project.xml" in members
                    else next((n for n in members if n.endswith(".xml")), None))
        if xml_name is None:
            return []
        info = z.getinfo(xml_name)
        if (info.file_size > _MAX_XML_BYTES
                or info.file_size / max(info.compress_size, 1) > _MAX_XML_RATIO):
            raise ValueError("dawproject XML too large (possible zip bomb)")
        root = ET.fromstring(z.read(xml_name))

    out: list[str] = []
    seen: set[str] = set()
    for el in root.iter():
        path = el.attrib.get("path")
        if not path or not path.lower().endswith(_AUDIO_EXTS):
            continue
        # Embedded in the .dawproject zip -> already inside the backed-up file; skip.
        if path in members or path.lstrip("./") in members:
            continue
        if path not in seen:
            seen.add(path)
            out.append(path)
    return out


class DawprojectAdapter:
    daw_id = "dawproject"
    display_name = "DAWproject (Bitwig / Studio One)"
    extensions = (".dawproject",)
    backup_root = "DAWprojectBackups"

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return walk_for_extensions(roots, self.extensions, self.skip_dirs())

    def parse_project(self, project_path: Path) -> list[FileRef]:
        try:
            paths = read_sample_paths(project_path)
        except (zipfile.BadZipFile, ET.ParseError) as e:
            raise ValueError(f"could not parse .dawproject: {e}") from e
        refs: list[FileRef] = []
        for p in paths:
            if os.path.isabs(p) or (len(p) > 1 and p[1] == ":"):
                refs.append(FileRef(name=Path(p).name, absolute_path=p))
            else:
                refs.append(FileRef(name=Path(p).name, relative_path=p))
        return refs

    def project_name(self, project_path: Path) -> str:
        return project_path.stem

    def skip_dirs(self) -> set[str]:
        return set(COMMON_SKIP)

    def default_libraries(self) -> list[Path]:
        return []
