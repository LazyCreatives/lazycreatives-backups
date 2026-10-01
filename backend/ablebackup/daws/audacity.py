"""Audacity adapter — both project generations:

* .aup3 (Audacity 3+): ONE SQLite database holding the project doc and all audio
  blocks. Self-contained by design — there are no external sample references to
  gather, so refs are empty and a backed-up copy is portable by construction.
  parse_project still proves the file is structurally an Audacity project (SQLite
  magic + the expected tables) so corruption is caught at scan AND verify time.

* .aup (legacy 1.x/2.x): an XML document plus a sibling "<name>_data/" folder of
  .au block files. Every file in _data is backed up (preserving layout); block
  files the XML names but the folder lacks are reported missing — the legacy
  equivalent of missing samples. <…aliasblockfile aliasfile="…"> entries reference
  EXTERNAL audio (the old "read directly" import mode); those are gathered like
  any other DAW's external samples. No portable rewrite: legacy Audacity expects
  absolute alias paths, so aliased projects are honestly reported non-portable
  (consolidate inside Audacity for true portability).
"""
import sqlite3
from pathlib import Path

import defusedxml.ElementTree as ET

from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.models import FileRef

_AUP3_MAGIC = b"SQLite format 3\x00"


def _check_aup3(project_path: Path) -> None:
    """Raise ValueError unless the file is a structurally sound .aup3 (SQLite with
    Audacity's tables). Read-only + immutable: never touches a live project's WAL."""
    with open(project_path, "rb") as fh:
        if fh.read(16) != _AUP3_MAGIC:
            raise ValueError("not an .aup3 (missing SQLite header)")
    uri = f"file:{project_path}?mode=ro&immutable=1"
    try:
        conn = sqlite3.connect(uri, uri=True)
        try:
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            conn.close()
    except sqlite3.Error as e:
        raise ValueError(f"unreadable .aup3: {e}") from e
    if "project" not in tables or "sampleblocks" not in tables:
        raise ValueError("not an Audacity project (missing project/sampleblocks tables)")


def _parse_aup(project_path: Path) -> tuple[list[FileRef], dict]:
    """Refs + metadata for a legacy .aup: all _data block files (and any the XML
    expects but are gone), plus external aliasfile audio."""
    root = ET.parse(project_path).getroot()
    project_dir = project_path.parent
    projname = root.attrib.get("projname") or f"{project_path.stem}_data"
    data_dir = project_dir / projname

    index: dict[str, Path] = {}
    if data_dir.is_dir():
        index = {p.name: p for p in data_dir.rglob("*") if p.is_file()}

    refs: list[FileRef] = []
    seen: set[str] = set()
    tracks = 0
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]            # strip the audacity xmlns
        if tag.endswith("track"):
            tracks += 1
        alias = el.attrib.get("aliasfile")
        if alias:                                   # external audio (read-directly import)
            if alias not in seen:
                seen.add(alias)
                refs.append(FileRef(name=Path(alias).name, absolute_path=alias))
        name = el.attrib.get("filename")
        if name and name not in seen:               # internal block file by name
            seen.add(name)
            p = index.pop(name, None)
            rel = str(p.relative_to(project_dir)) if p is not None \
                else f"{projname}/{name}"           # declared but gone -> reported missing
            refs.append(FileRef(name=name, relative_path=rel))
    # Anything left in _data the XML didn't name (summaries, strays) rides along too:
    # completeness beats minimality for a backup.
    for name, p in index.items():
        if name not in seen:
            refs.append(FileRef(name=name, relative_path=str(p.relative_to(project_dir))))

    rate = root.attrib.get("rate")
    meta = {"tempo": None, "tracks": tracks or None, "plugins": [],
            "rate": float(rate) if rate else None}
    return refs, meta


class AudacityAdapter:
    daw_id = "audacity"
    display_name = "Audacity"
    extensions = (".aup3", ".aup")
    backup_root = "AudacityBackups"

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return walk_for_extensions(roots, self.extensions, self.skip_dirs())

    def parse_project(self, project_path: Path) -> list[FileRef]:
        return self.parse_with_meta(project_path)[0]

    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]:
        if project_path.suffix.lower() == ".aup3":
            _check_aup3(project_path)               # raises -> scanner skips corrupt files
            return [], {"tempo": None, "tracks": None, "plugins": []}
        try:
            return _parse_aup(project_path)
        except ET.ParseError as e:
            raise ValueError(f"could not parse .aup: {e}") from e

    def project_name(self, project_path: Path) -> str:
        return project_path.stem

    def skip_dirs(self) -> set[str]:
        return set(COMMON_SKIP)

    def default_libraries(self) -> list[Path]:
        return []
