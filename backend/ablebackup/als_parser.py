import gzip
import xml.parsers.expat
import xml.etree.ElementTree as _ET   # only for the Element type hint / _fileref_to_model callers
from pathlib import Path

from defusedxml.common import (
    DTDForbidden,
    EntitiesForbidden,
    ExternalReferenceForbidden,
)

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
    """Build a FileRef from an ElementTree <FileRef> element.

    Still used by the Ableton adapter's portable rewrite, which operates on a real
    ElementTree. The fast scan path (parse_als) builds FileRefs directly from expat
    without ever constructing a tree — see _FileRefHandler.
    """
    absolute = _value_of(fileref, "Path")
    relative = _relative_path(fileref)
    name = _value_of(fileref, "Name") or ""
    size_val = _value_of(fileref, "OriginalFileSize")  # Live records the sample's size
    size = int(size_val) if size_val and size_val.isdigit() else 0
    return FileRef(name=name, absolute_path=absolute, relative_path=relative, size=size)


_VIDEO_EXTS = (".mov", ".mp4", ".m4v", ".avi", ".mkv", ".mpg", ".mpeg")


class _FileRefHandler:
    """A streaming expat handler that extracts user media <FileRef>s without building
    a DOM. The .als XML is enormous (hundreds of MB decompressed, tens of millions of
    elements); a full ElementTree of that is the scan's dominant cost. We instead pull
    out just the handful of fields each FileRef needs as the parser streams past.

    Semantics match the old tree walk exactly:
      * a <FileRef> whose immediate parent is <SampleRef> is a real audio sample;
      * any other <FileRef> (e.g. inside <VideoClip>) is kept only if it points at a
        video file — a video extension can't be a factory/device preset, so this stays
        noise-free while built-in device/preset FileRefs are dropped.
    """

    __slots__ = (
        "refs", "_depth", "_tags", "_fr_depth", "_fr_parent_is_sample",
        "_absolute", "_relative", "_name", "_size", "_rel_dirs", "_in_rel",
    )

    def __init__(self) -> None:
        self.refs: list[FileRef] = []
        self._depth = 0
        self._tags: list[str] = []          # element-name stack (for the FileRef's parent)
        self._fr_depth = -1                 # depth of the FileRef we're currently inside
        self._fr_parent_is_sample = False
        self._absolute: str | None = None
        self._relative: str | None = None
        self._name: str | None = None
        self._size = 0
        self._rel_dirs: list[str] | None = None  # Live 9/10 RelativePathElement chain
        self._in_rel = False

    def start(self, name: str, attrs: dict) -> None:
        depth = self._depth
        self._depth = depth + 1
        if name == "FileRef":
            # Begin a fresh capture. Nested FileRefs don't occur in .als, so a flat
            # set of fields is enough.
            self._fr_depth = depth
            self._fr_parent_is_sample = bool(self._tags) and self._tags[-1] == "SampleRef"
            self._absolute = None
            self._relative = None
            self._name = None
            self._size = 0
            self._rel_dirs = None
            self._in_rel = False
        elif self._fr_depth >= 0:
            # We're inside a FileRef subtree — pick up the fields we care about. Match
            # ElementTree's .find()/_value_of semantics: only direct children of the
            # FileRef count (depth == fr_depth + 1).
            direct = depth == self._fr_depth + 1
            if name == "Path":
                if direct:
                    self._absolute = attrs.get("Value")
            elif name == "RelativePath":
                if direct:
                    v = attrs.get("Value")
                    if v:
                        self._relative = v
                    else:
                        self._in_rel = True   # Live 9/10 chain follows
                        self._rel_dirs = []
            elif name == "Name":
                if direct:
                    self._name = attrs.get("Value")
            elif name == "OriginalFileSize":
                if direct:
                    v = attrs.get("Value")
                    if v and v.isdigit():
                        self._size = int(v)
            elif name == "RelativePathElement" and self._in_rel:
                d = attrs.get("Dir")
                if d:
                    self._rel_dirs.append(d)
        self._tags.append(name)

    def end(self, name: str) -> None:
        self._depth -= 1
        self._tags.pop()
        if name == "RelativePath" and self._in_rel:
            self._in_rel = False
        elif name == "FileRef" and self._depth == self._fr_depth:
            rel = self._relative
            if rel is None and self._rel_dirs:
                parts = list(self._rel_dirs)
                if self._name:
                    parts.append(self._name)
                rel = "/".join(parts) if parts else None
            model = FileRef(
                name=self._name or "",
                absolute_path=self._absolute,
                relative_path=rel,
                size=self._size,
            )
            if self._fr_parent_is_sample:
                self.refs.append(model)
            else:
                path = (model.relative_path or model.absolute_path or model.name or "").lower()
                if path.endswith(_VIDEO_EXTS):
                    self.refs.append(model)
            self._fr_depth = -1


def _forbid_dtd(name, sysid, pubid, has_internal_subset):
    raise DTDForbidden(name, sysid, pubid)


def _forbid_entity(name, is_param, value, base, sysid, pubid, notation_name):
    raise EntitiesForbidden(name, value, base, sysid, pubid, notation_name)


def _forbid_unparsed_entity(name, base, sysid, pubid, notation_name):
    raise EntitiesForbidden(name, None, base, sysid, pubid, notation_name)


def _forbid_external(context, base, sysid, pubid):
    raise ExternalReferenceForbidden(context, base, sysid, pubid)


class _TempoFound(Exception):
    """Raised to stop parsing the moment the project tempo is captured."""


class _TempoHandler:
    __slots__ = ("tempo", "_depth", "_in_tempo")

    def __init__(self) -> None:
        self.tempo: float | None = None
        self._depth = 0
        self._in_tempo = 0  # depth of the enclosing <Tempo>, or 0

    def start(self, name: str, attrs: dict) -> None:
        self._depth += 1
        if name == "Tempo":
            self._in_tempo = self._depth
        elif self._in_tempo and name == "Manual" and "Value" in attrs:
            try:
                self.tempo = float(attrs["Value"])
            except (TypeError, ValueError):
                self.tempo = None
            raise _TempoFound  # the manual tempo is all we need — stop here

    def end(self, name: str) -> None:
        if name == "Tempo" and self._in_tempo == self._depth:
            self._in_tempo = 0
        self._depth -= 1


def read_tempo(als_path: Path) -> float | None:
    """The project's BPM, read by streaming only until the <Tempo> (near the top of
    the .als), so it's cheap. Returns None if unreadable/absent."""
    handler = _TempoHandler()
    parser = xml.parsers.expat.ParserCreate()
    parser.StartElementHandler = handler.start
    parser.EndElementHandler = handler.end
    parser.StartDoctypeDeclHandler = _forbid_dtd
    parser.EntityDeclHandler = _forbid_entity
    parser.UnparsedEntityDeclHandler = _forbid_unparsed_entity
    parser.ExternalEntityRefHandler = _forbid_external
    try:
        with gzip.open(als_path, "rb") as fh:
            parser.ParseFile(fh)
    except _TempoFound:
        pass
    except (OSError, xml.parsers.expat.ExpatError, DTDForbidden,
            EntitiesForbidden, ExternalReferenceForbidden):
        return None
    return handler.tempo


def parse_als(als_path: Path) -> list[FileRef]:
    """Decompress an .als and return its user media references.

    <FileRef>s wrapped in <SampleRef> are real audio samples. The .als also carries
    FileRefs for built-in devices and factory/Core-Library presets (Simpler, EQ
    Eight, .adv, cached plugin .aupreset); those ship with Ableton and are excluded
    so they don't show up as bogus "missing" refs. Video files (referenced outside
    SampleRef) are also included — a video extension can't be a factory preset, so
    this stays noise-free.

    Parsing streams through expat and builds no DOM (the .als is untrusted, so DTDs,
    internal entities and external references are forbidden — same protections
    defusedxml gives, replicated on the streaming parser).
    """
    handler = _FileRefHandler()
    parser = xml.parsers.expat.ParserCreate()
    parser.StartElementHandler = handler.start
    parser.EndElementHandler = handler.end
    # Untrusted input: refuse DTDs / entity definitions / external references, exactly
    # as defusedxml.ElementTree.parse(forbid_dtd, forbid_entities, forbid_external).
    parser.StartDoctypeDeclHandler = _forbid_dtd
    parser.EntityDeclHandler = _forbid_entity
    parser.UnparsedEntityDeclHandler = _forbid_unparsed_entity
    parser.ExternalEntityRefHandler = _forbid_external
    with gzip.open(als_path, "rb") as fh:
        parser.ParseFile(fh)
    return handler.refs
