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
    # Live 9/10: <RelativePathElement Dir="Samples"/> chain + separate <Name/>
    dirs = [
        e.attrib["Dir"]
        for e in rel.findall("RelativePathElement")
        if e.attrib.get("Dir")
    ]
    if not dirs:
        return None
    name = _value_of(fileref, "Name") or ""
    parts = dirs + ([name] if name else [])
    return "/".join(parts)


def _fileref_to_model(fileref: _ET.Element) -> FileRef:
    absolute = _value_of(fileref, "Path")
    relative = _relative_path(fileref)
    name = _value_of(fileref, "Name") or ""
    size_val = _value_of(fileref, "OriginalFileSize")  # Live records the sample's size
    size = int(size_val) if size_val and size_val.isdigit() else 0
    return FileRef(name=name, absolute_path=absolute, relative_path=relative, size=size)


_VIDEO_EXTS = (".mov", ".mp4", ".m4v", ".avi", ".mkv", ".mpg", ".mpeg")


def parse_als(als_path: Path) -> list[FileRef]:
    """Decompress an .als and return its user media references.

    <FileRef>s wrapped in <SampleRef> are real audio samples. The .als also carries
    FileRefs for built-in devices and factory/Core-Library presets (Simpler, EQ
    Eight, .adv, cached plugin .aupreset); those ship with Ableton and are excluded
    so they don't show up as bogus "missing" refs. Video files (referenced outside
    SampleRef) are also included — a video extension can't be a factory preset, so
    this stays noise-free.
    """
    with gzip.open(als_path, "rt", encoding="utf-8") as fh:
        tree = ET.parse(fh)
    root = tree.getroot()
    refs: list[FileRef] = []
    seen: set[int] = set()
    for sample_ref in root.iter("SampleRef"):
        fr = sample_ref.find("FileRef")
        if fr is not None:
            refs.append(_fileref_to_model(fr))
            seen.add(id(fr))
    for fr in root.iter("FileRef"):
        if id(fr) in seen:
            continue
        model = _fileref_to_model(fr)
        path = (model.relative_path or model.absolute_path or model.name or "").lower()
        if path.endswith(_VIDEO_EXTS):
            refs.append(model)
    return refs
