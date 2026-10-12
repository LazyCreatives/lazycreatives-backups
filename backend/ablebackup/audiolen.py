"""How long a song file is, read from its header only (nothing is decoded and the
file is only ever opened for reading). Used to hide very short exports (test
bounces, a one-shot) from a project's songs list.

WAV, AIFF, FLAC and OGG lengths are exact. MP3 uses the Xing/VBRI header when the
encoder wrote one, else the first frame's bitrate over the file size. M4A, AAC and
WMA lengths can't be read this way: they come back as None and are never hidden.
"""
from __future__ import annotations

import struct
from pathlib import Path

# Lengths already read, by (path, size, mtime), so a page refresh doesn't reopen files.
_lengths: dict[tuple[str, int, float], float | None] = {}
_MAX_CACHE = 20_000


def seconds(path: str) -> float | None:
    p = Path(path)
    try:
        st = p.stat()
    except OSError:
        return None
    key = (str(p), st.st_size, st.st_mtime)
    if key not in _lengths:
        if len(_lengths) > _MAX_CACHE:
            _lengths.clear()
        reader = _READERS.get(p.suffix.lower())
        try:
            with open(p, "rb") as f:
                secs = reader(f, st.st_size) if reader else None
        except (OSError, ValueError, struct.error, ZeroDivisionError):
            secs = None
        _lengths[key] = secs if secs is None or secs >= 0 else None
    return _lengths[key]


def _wav(f, size: int) -> float | None:
    head = f.read(12)
    if len(head) < 12 or head[:4] not in (b"RIFF", b"RF64") or head[8:12] != b"WAVE":
        return None
    rf64 = head[:4] == b"RF64"
    byte_rate = data_len = None
    while True:
        ch = f.read(8)
        if len(ch) < 8:
            break
        cid, n = ch[:4], struct.unpack("<I", ch[4:])[0]
        if cid == b"ds64" and rf64:
            body = f.read(n)
            data_len = struct.unpack("<Q", body[8:16])[0]
            n = 0
        elif cid == b"fmt ":
            body = f.read(n)
            byte_rate = struct.unpack("<I", body[8:12])[0]
            n = 0
        elif cid == b"data":
            if data_len is None or not rf64:
                data_len = n
            if n == 0xFFFFFFFF or n > size:   # still being written, or a broken size
                data_len = max(0, size - f.tell())
            break
        f.seek(n + (n & 1), 1)
    return data_len / byte_rate if byte_rate and data_len is not None else None


def _ext80(b: bytes) -> float:
    """The 80-bit float AIFF uses for its sample rate."""
    exp, mant = struct.unpack(">HQ", b)
    if exp == 0 and mant == 0:
        return 0.0
    return mant * 2.0 ** ((exp & 0x7FFF) - 16383 - 63)


def _aiff(f, size: int) -> float | None:
    head = f.read(12)
    if len(head) < 12 or head[:4] != b"FORM" or head[8:12] not in (b"AIFF", b"AIFC"):
        return None
    while True:
        ch = f.read(8)
        if len(ch) < 8:
            return None
        cid, n = ch[:4], struct.unpack(">I", ch[4:])[0]
        if cid == b"COMM":
            body = f.read(18)
            frames = struct.unpack(">I", body[2:6])[0]
            rate = _ext80(body[8:18])
            return frames / rate if rate else None
        f.seek(n + (n & 1), 1)


def _flac(f, size: int) -> float | None:
    if f.read(4) != b"fLaC":
        return None
    hdr = f.read(4)
    if len(hdr) < 4 or (hdr[0] & 0x7F) != 0:  # STREAMINFO always comes first
        return None
    info = f.read(34)
    bits = int.from_bytes(info[10:18], "big")
    rate = bits >> 44
    total = bits & ((1 << 36) - 1)
    return total / rate if rate and total else None


def _ogg(f, size: int) -> float | None:
    head = f.read(512)
    if head[:4] != b"OggS":
        return None
    rate = None
    i = head.find(b"\x01vorbis")
    if i != -1:
        rate = struct.unpack("<I", head[i + 12:i + 16])[0]
    elif (i := head.find(b"OpusHead")) != -1:
        rate = 48000   # Opus positions always count at 48 kHz
    if not rate:
        return None
    f.seek(max(0, size - 65536))
    tail = f.read()
    j = tail.rfind(b"OggS")
    if j == -1 or j + 14 > len(tail):
        return None
    granule = struct.unpack("<q", tail[j + 6:j + 14])[0]
    return granule / rate if granule > 0 else None


_MP3_RATES = {  # (version bits) -> sample rates
    3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}
_MP3_KBPS_V1 = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
_MP3_KBPS_V2 = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)


def _mp3(f, size: int) -> float | None:
    start = 0
    head = f.read(10)
    if head[:3] == b"ID3" and len(head) == 10:   # skip the tag block in front
        start = 10 + ((head[6] & 0x7F) << 21 | (head[7] & 0x7F) << 14 | (head[8] & 0x7F) << 7 | (head[9] & 0x7F))
    f.seek(start)
    buf = f.read(65536)
    for i in range(len(buf) - 4):
        if buf[i] != 0xFF or (buf[i + 1] & 0xE0) != 0xE0:
            continue
        b1, b2, b3 = buf[i + 1], buf[i + 2], buf[i + 3]
        ver, layer = (b1 >> 3) & 3, (b1 >> 1) & 3
        bri, sri = b2 >> 4, (b2 >> 2) & 3
        if ver == 1 or layer != 1 or bri in (0, 15) or sri == 3:   # Layer III only
            continue
        rate = _MP3_RATES[ver][sri]
        kbps = (_MP3_KBPS_V1 if ver == 3 else _MP3_KBPS_V2)[bri]
        per_frame = 1152 if ver == 3 else 576
        mono = (b3 >> 6) == 3
        side = (17 if mono else 32) if ver == 3 else (9 if mono else 17)
        x = i + 4 + side
        tag = buf[x:x + 4]
        if tag in (b"Xing", b"Info") and buf[x + 7] & 1:
            frames = struct.unpack(">I", buf[x + 8:x + 12])[0]
            return frames * per_frame / rate
        v = i + 36
        if buf[v:v + 4] == b"VBRI":
            frames = struct.unpack(">I", buf[v + 14:v + 18])[0]
            return frames * per_frame / rate
        return (size - start - i) * 8 / (kbps * 1000)
    return None


_READERS = {".wav": _wav, ".wave": _wav, ".aif": _aiff, ".aiff": _aiff, ".aifc": _aiff,
            ".flac": _flac, ".ogg": _ogg, ".oga": _ogg, ".opus": _ogg, ".mp3": _mp3}
