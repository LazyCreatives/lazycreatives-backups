import gzip
import defusedxml.ElementTree as ET   # safe against XXE / billion-laughs; .als is untrusted input
import xml.etree.ElementTree as _ET   # only for the Element type hint
from pathlib import Path

from ablebackup.models import FileRef


def _value_of(parent: _ET.Element, tag: str) -> str | None:
    child = parent.find(tag)
    if child is not None and "Value" in child.attrib:
        return child.attrib["Value"]
    return None


def _relative_path(fileref: _ET.Element) -> str | None:
    rel = fileref.find("RelativePath")
    if rel is None:
        return None
    # Live 11/12: <RelativePath Value="Samples/Imported/loop.wav"/>
    if "Value" in rel.attrib and rel.attrib["Value"]:
        return rel.attrib["Value"]
    return None


def _fileref_to_model(fileref: _ET.Element) -> FileRef:
    absolute = _value_of(fileref, "Path")
    relative = _relative_path(fileref)
    name = _value_of(fileref, "Name") or ""
    return FileRef(name=name, absolute_path=absolute, relative_path=relative)


def parse_als(als_path: Path) -> list[FileRef]:
    """Decompress an .als and return all file references it contains."""
    with gzip.open(als_path, "rt", encoding="utf-8") as fh:
        tree = ET.parse(fh)
    root = tree.getroot()
    return [_fileref_to_model(fr) for fr in root.iter("FileRef")]
