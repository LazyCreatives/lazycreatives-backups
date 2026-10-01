"""Clean-room FL Studio .flp reader.

Extracts sample paths with no third-party library, so it works regardless of FL
version: events are sized by FL's stable id classes (1/2/4 bytes, or a varint-
prefixed blob for text), so unknown events from newer FL are skipped by size
rather than crashing the parse. (PyFLP, by contrast, hard-fails on unknown event
ids — and is GPLv3.)
"""
import struct
from pathlib import Path

SAMPLE_PATH_EVENT = 196          # ChannelID.SamplePath — a TEXT event
PLUGIN_NAME_EVENT = 201          # PluginID.DefaultName — "FLEX", "Serum", … (TEXT)
TEMPO_EVENT = 156                # ProjectID.Tempo — DWORD, milli-BPM (175000 = 175)
_FACTORY = "%FLStudioFactoryData%"  # stock samples that ship with FL


def _iter_events(data: bytes):
    # Bounds-checked throughout: a truncated/corrupt .flp must raise ValueError
    # (which the scanner skips), never an unguarded struct.error that aborts the
    # whole scan.
    if len(data) < 8 or data[:4] != b"FLhd":
        raise ValueError("not an FLP file (missing FLhd header)")
    pos = 8 + struct.unpack_from("<I", data, 4)[0]  # skip FLhd + its payload
    if pos + 8 > len(data) or data[pos:pos + 4] != b"FLdt":
        raise ValueError("FLP missing FLdt chunk")
    pos += 4
    end = min(pos + 4 + struct.unpack_from("<I", data, pos)[0], len(data))
    pos += 4
    while pos < end:
        eid = data[pos]; pos += 1
        if eid < 64:        # BYTE value
            yield eid, data[pos] if pos < end else 0
            pos += 1
        elif eid < 128:     # WORD value
            yield eid, struct.unpack_from("<H", data, pos)[0] if pos + 2 <= end else 0
            pos += 2
        elif eid < 192:     # DWORD value
            yield eid, struct.unpack_from("<I", data, pos)[0] if pos + 4 <= end else 0
            pos += 4
        else:               # TEXT/DATA: GOL varint length, then that many bytes
            length = shift = 0
            while pos < end:
                b = data[pos]; pos += 1
                length |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            yield eid, data[pos:pos + length]
            pos += length


def _decode_text(payload: bytes) -> str:
    s = payload.decode("utf-16-le", "ignore").rstrip("\x00")
    if not s:
        s = payload.decode("latin-1", "ignore").rstrip("\x00")
    return s


def read_all(project_path) -> tuple[list[str], dict]:
    """One event pass: (user sample paths, display metadata).

    Tempo is event 156 in milli-BPM. Plugins are every generator/effect's default
    name (event 201) — includes FL's own (FLEX, Fruity Limiter); they're part of the
    project's dependency story too. Track count stays None: FL's channels/patterns/
    playlist model has no lane count comparable to the other DAWs'."""
    data = Path(project_path).read_bytes()
    paths: list[str] = []
    plugins: list[str] = []
    seen_p: set[str] = set()
    seen_pl: set[str] = set()
    tempo: float | None = None
    for eid, payload in _iter_events(data):
        if eid == SAMPLE_PATH_EVENT:
            s = _decode_text(payload)
            if s and _FACTORY not in s and s not in seen_p:
                seen_p.add(s)
                paths.append(s)
        elif eid == PLUGIN_NAME_EVENT:
            s = _decode_text(payload)
            if s and s not in seen_pl:
                seen_pl.add(s)
                plugins.append(s)
        elif eid == TEMPO_EVENT and tempo is None and isinstance(payload, int) and payload:
            tempo = payload / 1000.0
    return paths, {"tempo": tempo, "tracks": None, "plugins": plugins}


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

    Payload encoding mirrors the original event: utf-16-le (modern FL) when the
    original decoded that way, else latin-1 (legacy), null terminator preserved.
    """
    data = Path(project_path).read_bytes()
    if len(data) < 8 or data[:4] != b"FLhd":
        raise ValueError("not an FLP file (missing FLhd header)")
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
        if eid < 64:
            pos += 1
            out += data[ev_start:pos]
        elif eid < 128:
            pos += 2
            out += data[ev_start:pos]
        elif eid < 192:
            pos += 4
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
                utf16 = payload.decode("utf-16-le", "ignore").rstrip("\x00")
                s = utf16 or payload.decode("latin-1", "ignore").rstrip("\x00")
                new = mapper(s) if s else None
                if new and new != s:
                    payload = (new.encode("utf-16-le") + b"\x00\x00") if utf16 \
                        else (new.encode("latin-1", "replace") + b"\x00")
                    changed = True
            out.append(eid)
            out += _varint(len(payload))
            out += payload
    if not changed:
        return None
    return (data[:body_start] + b"FLdt" + struct.pack("<I", len(out))
            + bytes(out) + data[end:])
