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
_FACTORY = "%FLStudioFactoryData%"  # stock samples that ship with FL


def _iter_events(data: bytes):
    if data[:4] != b"FLhd":
        raise ValueError("not an FLP file (missing FLhd header)")
    pos = 8 + struct.unpack_from("<I", data, 4)[0]  # skip FLhd + its payload
    if data[pos:pos + 4] != b"FLdt":
        raise ValueError("FLP missing FLdt chunk")
    pos += 4
    end = min(pos + 4 + struct.unpack_from("<I", data, pos)[0], len(data))
    pos += 4
    while pos < end:
        eid = data[pos]; pos += 1
        if eid < 64:        # BYTE value
            pos += 1
        elif eid < 128:     # WORD value
            pos += 2
        elif eid < 192:     # DWORD value
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


def read_sample_paths(project_path) -> list[str]:
    """User sample paths referenced by an .flp (factory samples excluded, deduped)."""
    data = Path(project_path).read_bytes()
    out: list[str] = []
    seen: set[str] = set()
    for eid, payload in _iter_events(data):
        if eid != SAMPLE_PATH_EVENT:
            continue
        s = payload.decode("utf-16-le", "ignore").rstrip("\x00")
        if not s:
            s = payload.decode("latin-1", "ignore").rstrip("\x00")
        if s and _FACTORY not in s and s not in seen:
            seen.add(s)
            out.append(s)
    return out
