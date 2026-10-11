"""Clean-room FL Studio .flp reader.

Extracts sample paths with no third-party library, so it works regardless of FL
version: events are sized by FL's stable id classes (1/2/4 bytes, or a varint-
prefixed blob for text), so unknown events from newer FL are skipped by size
rather than crashing the parse. (PyFLP, by contrast, hard-fails on unknown event
ids — and is GPLv3.)
"""
import re
import struct
from pathlib import Path

from ablebackup.models import plausible_bpm

SAMPLE_PATH_EVENT = 196          # ChannelID.SamplePath — a TEXT event
PLUGIN_NAME_EVENT = 201          # PluginID.DefaultName — "FLEX", "Serum", … (TEXT)
VERSION_EVENT = 199              # ProjectID.FLVersion — ASCII "20.8.4.2576"
TEMPO_EVENT = 156                # ProjectID.Tempo — DWORD, milli-BPM (175000 = 175)
TEMPO_COARSE_EVENT = 66          # ProjectID._TempoCoarse — WORD, whole BPM (FL before 11)
TEMPO_FINE_EVENT = 93            # ProjectID._TempoFine — WORD, thousandths of a BPM
_FACTORY = "%FLStudioFactoryData%"  # stock samples that ship with FL
_VERSION_RE = re.compile(r"\d{1,3}(\.\d{1,5}){1,3}")
# The FL version event as bytes: id 199, a one-byte length, "20.8.4.2576", a null.
_VERSION_BYTES = re.compile(rb"\xc7[\x04-\x20](\d{1,3}(?:\.\d{1,5}){1,3})\x00")
_AUDIO_EXT_RE = re.compile(r"\.[A-Za-z0-9]{1,6}$")


def _events_bounds(data: bytes) -> tuple[int, int]:
    """(first event offset, end of the FLdt chunk). Raises ValueError if not an FLP."""
    if len(data) < 8 or data[:4] != b"FLhd":
        raise ValueError("not an FLP file (missing FLhd header)")
    pos = 8 + struct.unpack_from("<I", data, 4)[0]  # skip FLhd + its payload
    if pos + 8 > len(data) or data[pos:pos + 4] != b"FLdt":
        raise ValueError("FLP missing FLdt chunk")
    return pos + 8, min(pos + 8 + struct.unpack_from("<I", data, pos + 4)[0], len(data))


# Events newer FL versions write with a size their id range doesn't say: FL Studio
# 26 (2026) saves id 172 with a one-byte value although 128-191 are four-byte
# events, which threw every later event off (3221226 BPM, garbled names). Tried in
# turn, only when the plain read doesn't hold together.
_QUIRKS: tuple[dict, ...] = ({172: 1},)


def _size(eid: int, quirks: dict) -> int | None:
    """Bytes in an event's value; None for TEXT/DATA (a varint length comes first)."""
    if eid in quirks:
        return quirks[eid]
    return 1 if eid < 64 else 2 if eid < 128 else 4 if eid < 192 else None


def _walk(data: bytes, pos: int, end: int, quirks: dict | None = None):
    """(event id, value, offset after the event). Values: int for BYTE/WORD/DWORD
    events, bytes for TEXT/DATA ones. The last offset can run past `end` when the
    stream is damaged or not laid out the way we expect."""
    quirks = quirks or {}
    while pos < end:
        eid = data[pos]; pos += 1
        size = _size(eid, quirks)
        if size is not None:
            yield eid, int.from_bytes(data[pos:min(pos + size, end)], "little"), pos + size
            pos += size
        else:               # TEXT/DATA: GOL varint length, then that many bytes
            length = shift = 0
            while pos < end:
                b = data[pos]; pos += 1
                length |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            yield eid, data[pos:pos + length], pos + length
            pos += length


def _is_unicode(version: str | None) -> bool:
    """FL 11.5 and later save text as UTF-16; older versions as plain 8-bit text."""
    if not version:
        return True
    try:
        return [int(x) for x in version.split(".")[:2]] >= [11, 5]
    except ValueError:
        return True


def _text(payload: bytes, unicode: bool) -> str | None:
    """A TEXT event's string, or None when the bytes aren't text FL would write: FL
    ends every string with a null and never puts line breaks or other control
    characters in a sample path or plugin name."""
    if unicode:
        if len(payload) < 2 or len(payload) % 2 or payload[-2:] != b"\x00\x00":
            return None
        try:
            s = payload[:-2].decode("utf-16-le")
        except UnicodeDecodeError:
            return None
    else:
        if not payload or payload[-1:] != b"\x00":
            return None
        s = payload[:-1].decode("cp1252", "replace")
    if any(ord(c) < 32 or 0xE000 <= ord(c) <= 0xF8FF or c in "\ufffd\ufffe\uffff" for c in s):
        return None
    return s


def _looks_like_sample(s: str) -> bool:
    return 1 < len(s) <= 1024 and bool(_AUDIO_EXT_RE.search(s.rstrip()))


def _looks_like_plugin(s: str) -> bool:
    return 1 < len(s) <= 64 and any(c.isascii() and c.isalpha() for c in s)


def _read_events(data: bytes, start: int | None = None, quirks: dict | None = None) -> dict | None:
    """Read the project the normal way, one event after another. None when the read
    doesn't hold together (it ran past the end, the FL version string is garbled, or
    a sample path / plugin name isn't real text): then every value it produced would
    be read from the wrong bytes, so none of them can be trusted. `start` begins the
    read at another offset (where the FL version event really is)."""
    pos, end = _events_bounds(data)
    if start is not None:
        pos = start
    version: str | None = None
    texts: list[tuple[int, bytes]] = []
    tempo = coarse = fine = None
    last = pos
    for eid, value, last in _walk(data, pos, end, quirks):
        if eid == VERSION_EVENT and version is None:
            v = value.rstrip(b"\x00").decode("ascii", "replace")
            if not _VERSION_RE.fullmatch(v):
                return None
            version = v
        elif eid in (SAMPLE_PATH_EVENT, PLUGIN_NAME_EVENT):
            texts.append((eid, value))
        elif eid == TEMPO_EVENT and tempo is None and value:
            tempo = value / 1000.0
        elif eid == TEMPO_COARSE_EVENT and coarse is None:
            coarse = value
        elif eid == TEMPO_FINE_EVENT and fine is None:
            fine = value
    if last != end:
        return None
    unicode = _is_unicode(version)
    paths, plugins = [], []
    for eid, payload in texts:
        if payload.strip(b"\x00") == b"":
            continue                       # FL leaves many names empty
        s = _text(payload, unicode)
        if s is None:
            return None
        (paths if eid == SAMPLE_PATH_EVENT else plugins).append(s)
    if tempo is None and coarse:
        tempo = coarse + (fine or 0) / 1000.0
    return {"paths": paths, "plugins": plugins, "tempo": tempo, "version": version,
            "quirks": quirks or {}}


def _follow(data: bytes) -> dict | None:
    """The plain read, else the first newer-FL layout that holds together."""
    found = _read_events(data)
    if found is not None and found["version"] is not None:
        return found
    for quirks in _QUIRKS:
        alt = _read_events(data, quirks=quirks)
        if alt is not None and alt["version"] is not None:
            return alt
    return found


def _resync(data: bytes) -> dict | None:
    """When the normal read loses its place at the start, begin again from the FL
    version event (FL writes it first); if the read from there holds together to the
    end of the file, it's the whole project read properly."""
    pos, _ = _events_bounds(data)
    m = _VERSION_BYTES.search(data, pos, pos + 4096)
    if not m or m.start() == pos:
        return None
    return _read_events(data, m.start())


def _search_events(data: bytes) -> dict:
    """The careful fallback for a file the normal read can't follow: look through the
    raw bytes for sample-path and plugin-name events that are clearly real (proper
    null-ended text, a file name with an extension, a name with letters). Tempo is
    left blank: a number can't be told apart from any other four bytes."""
    unicode = True
    m = _VERSION_BYTES.search(data, 0, 4096)
    if m:
        unicode = _is_unicode(m.group(1).decode("ascii"))
    paths, plugins = [], []
    for eid, keep, out in ((SAMPLE_PATH_EVENT, _looks_like_sample, paths),
                           (PLUGIN_NAME_EVENT, _looks_like_plugin, plugins)):
        i = data.find(bytes([eid]))
        while i != -1:
            length = shift = 0
            j = i + 1
            while j < len(data) and shift < 21:
                b = data[j]; j += 1
                length |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            if 2 < length <= 2050 and j + length <= len(data):
                s = _text(data[j:j + length], unicode)
                if s and keep(s):
                    out.append(s)
            i = data.find(bytes([eid]), i + 1)
    return {"paths": paths, "plugins": plugins, "tempo": None}


def read_all(project_path) -> tuple[list[str], dict]:
    """One event pass: (user sample paths, display metadata).

    Tempo is event 156 in milli-BPM (66 + 93 in projects from before FL 11). Plugins
    are every generator/effect's default name (event 201) — includes FL's own (FLEX,
    Fruity Limiter); they're part of the project's dependency story too. Track count
    stays None: FL's channels/patterns/playlist model has no lane count comparable to
    the other DAWs'. A project the normal read can't follow gets the careful search
    instead, so garbled bytes never show up as sample names, plugins or a tempo."""
    data = Path(project_path).read_bytes()
    found = _follow(data)
    if found is None or found["version"] is None:   # lost its place, or never saw the version
        found = _resync(data) or found or _search_events(data)
    paths: list[str] = []
    plugins: list[str] = []
    for s in found["paths"]:
        if _FACTORY not in s and s not in paths:
            paths.append(s)
    for s in found["plugins"]:
        if s not in plugins:
            plugins.append(s)
    return paths, {"tempo": plausible_bpm(found["tempo"]), "tracks": None, "plugins": plugins}


def read_sample_paths(project_path) -> list[str]:
    """User sample paths referenced by an .flp (factory samples excluded, deduped)."""
    return read_all(project_path)[0]


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def rewrite_sample_paths(project_path, mapper) -> bytes | None:
    """A new .flp with each sample-path TEXT event mapped through `mapper(old) ->
    new | None`. Every other event is copied through byte-for-byte; only the FLdt
    chunk length and the rewritten payloads change. Returns None if nothing mapped.

    Payload encoding follows the project's FL version: UTF-16 from FL 11.5 on, plain
    8-bit text before, null terminator preserved. A file whose events can't be
    followed is never rewritten (None: the backup keeps it exactly as it is).
    """
    data = Path(project_path).read_bytes()
    if len(data) < 8 or data[:4] != b"FLhd":
        raise ValueError("not an FLP file (missing FLhd header)")
    found = _follow(data)
    if found is None:
        return None     # can't follow this file's events: copy it as it is
    unicode = _is_unicode(found["version"])
    body_start = 8 + struct.unpack_from("<I", data, 4)[0]   # offset of "FLdt"
    if body_start + 8 > len(data) or data[body_start:body_start + 4] != b"FLdt":
        raise ValueError("FLP missing FLdt chunk")
    payload_start = body_start + 8
    end = min(payload_start + struct.unpack_from("<I", data, body_start + 4)[0], len(data))

    out = bytearray()
    pos = payload_start
    changed = False
    while pos < end:
        ev_start = pos
        eid = data[pos]; pos += 1
        size = _size(eid, found["quirks"])
        if size is not None:
            pos += size
            out += data[ev_start:pos]
        else:
            length = shift = 0
            while pos < end:
                b = data[pos]; pos += 1
                length |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            payload = data[pos:pos + length]; pos += length
            if eid == SAMPLE_PATH_EVENT:
                s = _text(payload, unicode) if payload.strip(b"\x00") else None
                new = mapper(s) if s else None
                if new and new != s:
                    payload = (new.encode("utf-16-le") + b"\x00\x00") if unicode \
                        else (new.encode("cp1252", "replace") + b"\x00")
                    changed = True
            out.append(eid)
            out += _varint(len(payload))
            out += payload
    if not changed:
        return None
    return (data[:body_start] + b"FLdt" + struct.pack("<I", len(out))
            + bytes(out) + data[end:])
