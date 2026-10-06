"""Markers (locators, cues) saved in a project, so the app can show them on the song's
waveform. Read from the formats that keep them as plain text: Ableton (.als
locators, in beats), REAPER (.rpp MARKER lines, in seconds) and DAWproject
(project.xml markers, in beats or seconds). Other formats return an empty list.

Times come back in seconds from the start of the arrangement, using the project's
main tempo (tempo changes are not followed), so they line up with a song that was
exported from the start.
"""
from __future__ import annotations

import gzip
import re
import shlex
import xml.parsers.expat
import zipfile
from pathlib import Path

from ablebackup.als_parser import (
    _forbid_dtd, _forbid_entity, _forbid_external, _forbid_unparsed_entity,
)

MAX_MARKERS = 64


class _AlsMarkers:
    """Streams an .als: the first <Tempo><Manual Value> and every
    <Locators><Locators><Locator> with its <Time> and <Name>."""

    def __init__(self) -> None:
        self.tempo: float | None = None
        self.found: list[tuple[float, str]] = []
        self._path: list[str] = []
        self._in_tempo = 0
        self._loc: dict | None = None

    def start(self, name: str, attrs: dict) -> None:
        self._path.append(name)
        depth = len(self._path)
        if self.tempo is None:
            if name == "Tempo" and not self._in_tempo:
                self._in_tempo = depth
            elif self._in_tempo and name == "Manual" and "Value" in attrs:
                try:
                    self.tempo = float(attrs["Value"])
                except (TypeError, ValueError):
                    pass
        if name == "Locator" and depth >= 3 and self._path[-3:-1] == ["Locators", "Locators"]:
            self._loc = {"depth": depth}
        elif self._loc is not None and depth == self._loc["depth"] + 1 and "Value" in attrs:
            if name == "Time":
                self._loc["time"] = attrs["Value"]
            elif name == "Name":
                self._loc["name"] = attrs["Value"]

    def end(self, name: str) -> None:
        depth = len(self._path)
        if self._in_tempo == depth:
            self._in_tempo = 0
        if self._loc is not None and depth == self._loc["depth"]:
            try:
                self.found.append((float(self._loc.get("time", "")), str(self._loc.get("name", ""))))
            except ValueError:
                pass
            self._loc = None
        self._path.pop()


def _ableton(path: Path) -> list[tuple[float, str]]:
    h = _AlsMarkers()
    parser = xml.parsers.expat.ParserCreate()
    parser.StartElementHandler = h.start
    parser.EndElementHandler = h.end
    parser.StartDoctypeDeclHandler = _forbid_dtd
    parser.EntityDeclHandler = _forbid_entity
    parser.UnparsedEntityDeclHandler = _forbid_unparsed_entity
    parser.ExternalEntityRefHandler = _forbid_external
    try:
        with gzip.open(path, "rb") as fh:
            parser.ParseFile(fh)
    except Exception:  # unreadable, or a DTD/entity trick: no markers
        return []
    tempo = h.tempo if h.tempo and h.tempo > 0 else 120.0
    return [(beats * 60.0 / tempo, name) for beats, name in h.found]


_RPP_MARKER = re.compile(r"^\s*MARKER\s+(.*)$")


def _reaper(path: Path) -> list[tuple[float, str]]:
    """MARKER <index> <seconds> <name> <flags> ...; flags bit 1 marks a region, whose
    end comes as a second line with the same index (kept once, at its start)."""
    out: list[tuple[float, str]] = []
    regions: set[str] = set()
    try:
        text = path.read_text(errors="ignore")
    except OSError:
        return []
    for line in text.splitlines():
        m = _RPP_MARKER.match(line)
        if not m:
            continue
        try:
            parts = shlex.split(m.group(1))
        except ValueError:
            parts = m.group(1).split()
        if len(parts) < 2:
            continue
        idx, pos = parts[0], parts[1]
        name = parts[2] if len(parts) > 2 else ""
        try:
            flags = int(parts[3]) if len(parts) > 3 else 0
        except ValueError:
            flags = 0
        if flags & 1:
            if idx in regions:
                continue
            regions.add(idx)
        try:
            out.append((float(pos), name))
        except ValueError:
            continue
    return out


def _dawproject(path: Path) -> list[tuple[float, str]]:
    from ablebackup.daws.dawproject import _read_project_xml
    try:
        root, _ = _read_project_xml(path)
    except (zipfile.BadZipFile, OSError, Exception):
        return []
    if root is None:
        return []
    tempo = 120.0
    for el in root.iter("Tempo"):
        try:
            tempo = float(el.attrib.get("value", "")) or 120.0
        except ValueError:
            pass
        break
    out: list[tuple[float, str]] = []
    for markers in root.iter("Markers"):
        unit = (markers.attrib.get("timeUnit") or "beats").lower()
        for mk in markers.iter("Marker"):
            try:
                t = float(mk.attrib.get("time", ""))
            except ValueError:
                continue
            out.append((t if unit == "seconds" else t * 60.0 / tempo, mk.attrib.get("name", "")))
    return out


_READERS = {".als": _ableton, ".rpp": _reaper, ".dawproject": _dawproject}


def read_markers(project_path: str | Path) -> list[dict]:
    """[{"t": seconds, "name": str}] sorted by time; empty when the format keeps none."""
    p = Path(project_path)
    reader = _READERS.get(p.suffix.lower())
    if reader is None or not p.is_file():
        return []
    seen: set[tuple[float, str]] = set()
    out: list[dict] = []
    for t, name in sorted(reader(p)):
        key = (round(t, 2), name)
        if t < 0 or key in seen:
            continue
        seen.add(key)
        out.append({"t": round(t, 3), "name": name.strip()})
    return out[:MAX_MARKERS]
