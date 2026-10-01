"""DAWproject adapter — the open, documented format (zip + XML) that Bitwig and
Studio One can both export. One adapter, two DAWs.

The .dawproject is a single zip: we back up the file as-is (embedded media rides
along inside it) and follow only EXTERNAL referenced samples — detected as
<… path="…"> entries that are not members of the zip.
"""
import io
import os
import xml.etree.ElementTree as _ET
import zipfile
from pathlib import Path
from typing import Optional

import defusedxml.ElementTree as ET

from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.models import FileRef

_AUDIO_EXTS = (".wav", ".aif", ".aiff", ".flac", ".mp3", ".ogg", ".m4a", ".wv", ".aac")


# A .dawproject is attacker-supplyable (it's exactly what 'share' exchanges), so
# guard the project.xml member against a decompression bomb before reading it.
_MAX_XML_BYTES = 64 * 1024 * 1024
_MAX_XML_RATIO = 200


def _read_project_xml(dawproject_path):
    """The parsed project.xml root + the zip's member set (None root if no XML)."""
    with zipfile.ZipFile(dawproject_path) as z:
        members = set(z.namelist())
        xml_name = ("project.xml" if "project.xml" in members
                    else next((n for n in members if n.endswith(".xml")), None))
        if xml_name is None:
            return None, members
        info = z.getinfo(xml_name)
        if (info.file_size > _MAX_XML_BYTES
                or info.file_size / max(info.compress_size, 1) > _MAX_XML_RATIO):
            raise ValueError("dawproject XML too large (possible zip bomb)")
        return ET.fromstring(z.read(xml_name)), members


def _external_paths(root, members) -> list[str]:
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


def read_sample_paths(dawproject_path) -> list[str]:
    """External audio paths referenced by a .dawproject (embedded media excluded)."""
    root, members = _read_project_xml(dawproject_path)
    if root is None:
        return []
    return _external_paths(root, members)


# Plugin elements in the DAWproject spec; deviceName holds the plugin's display name.
_PLUGIN_TAGS = {"Vst2Plugin", "Vst3Plugin", "ClapPlugin", "AuPlugin"}


def read_meta_from_root(root) -> dict:
    """Display metadata from a parsed project.xml: Transport tempo, Track count,
    and plugin deviceNames (spec-standard elements; BuiltinDevice excluded)."""
    tempo: float | None = None
    tracks = 0
    plugins: list[str] = []
    seen: set[str] = set()
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]  # tolerate a namespaced export
        if tag == "Tempo" and tempo is None:
            try:
                tempo = float(el.attrib.get("value", ""))
            except ValueError:
                pass
        elif tag == "Track":
            tracks += 1
        elif tag in _PLUGIN_TAGS:
            name = (el.attrib.get("deviceName") or el.attrib.get("name") or "").strip()
            if name and name not in seen:
                seen.add(name)
                plugins.append(name)
    return {"tempo": tempo, "tracks": tracks or None, "plugins": plugins}


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
        return self._to_refs(paths)

    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]:
        try:
            root, members = _read_project_xml(project_path)
        except (zipfile.BadZipFile, ET.ParseError) as e:
            raise ValueError(f"could not parse .dawproject: {e}") from e
        if root is None:
            return [], {"tempo": None, "tracks": None, "plugins": []}
        return self._to_refs(_external_paths(root, members)), read_meta_from_root(root)

    def rewrite_portable(self, project_path: Path,
                         placement: Optional[dict] = None) -> Optional[bytes]:
        """A .dawproject whose project.xml points every EXTERNAL sample at its
        collected copy in the snapshot (the spec resolves external paths relative to
        the .dawproject file, so "_External/x.wav" lands next to it). The zip is
        rebuilt with only project.xml changed; embedded media is copied through
        untouched. Returns None when nothing external is referenced."""
        placement = placement or {}
        project_dir = Path(project_path).parent
        root, members = _read_project_xml(project_path)
        if root is None:
            return None
        changed = False
        for el in root.iter():
            p = el.attrib.get("path")
            if not p or not p.lower().endswith(_AUDIO_EXTS):
                continue
            if p in members or p.lstrip("./") in members:
                continue  # embedded — rides along inside the zip
            # join exactly as the resolver does, so placement keys match
            cand = Path(p) if os.path.isabs(p) or (len(p) > 1 and p[1] == ":") \
                else project_dir / Path(p.replace("\\", "/"))
            if not cand.is_file():
                continue  # missing — leave the reference for the verifier to report
            el.set("path", placement.get(str(cand)) or f"_External/{cand.name}")
            changed = True
        if not changed:
            return None
        xml_bytes = _ET.tostring(root, encoding="utf-8", xml_declaration=True)
        buf = io.BytesIO()
        with zipfile.ZipFile(project_path) as src, \
                zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as dst:
            xml_name = ("project.xml" if "project.xml" in members
                        else next(n for n in src.namelist() if n.endswith(".xml")))
            for info in src.infolist():
                if info.filename == xml_name:
                    dst.writestr(info.filename, xml_bytes)
                else:
                    dst.writestr(info, src.read(info.filename))
        return buf.getvalue()

    @staticmethod
    def _to_refs(paths: list[str]) -> list[FileRef]:
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
