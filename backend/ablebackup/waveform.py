"""Waveform outlines for exported songs, so the app can draw each song's shape.

Only uncompressed WAV and AIFF are read here (with the standard library). Other
formats return None and the app decodes them itself. Reading is sampled: a short
run of frames at the start of each slice, which is plenty for a picture and keeps a
long WAV from being read end to end.
"""
from __future__ import annotations

import os
import wave
from array import array
from pathlib import Path
import sys
import warnings

with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    try:
        import aifc  # removed in Python 3.13; AIFF outlines are skipped there
    except ImportError:  # pragma: no cover
        aifc = None  # type: ignore[assignment]

BARS = 120
_RUN = 2048  # frames read per slice
_cache: dict[tuple[str, float, int], list[float] | None] = {}


def _open(path: str):
    ext = Path(path).suffix.lower()
    if ext == ".wav":
        return wave.open(path, "rb"), False
    if ext in (".aif", ".aiff") and aifc is not None:
        return aifc.open(path, "rb"), True
    return None, False


def _to16(raw: bytes, width: int, big_endian: bool) -> array:
    """Keep the top 16 bits of each sample as signed 16-bit numbers."""
    if width == 1:  # WAV 8-bit is unsigned, AIFF 8-bit is signed
        return array("h", (((b - 256 if b > 127 else b) if big_endian else b - 128) << 8 for b in raw))
    if width == 2:
        a = array("h", raw)
    else:
        # the two most significant bytes of each sample
        hi = slice(0, 2) if big_endian else slice(width - 2, width)
        a = array("h", b"".join(raw[i:i + width][hi] for i in range(0, len(raw) - width + 1, width)))
    if big_endian != (sys.byteorder == "big"):
        a.byteswap()
    return a


def peaks(path: str, bars: int = BARS) -> list[float] | None:
    """`bars` numbers from 0 to 1, the loudest point in each slice of the song."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (path, st.st_mtime, st.st_size)
    if key in _cache:
        return _cache[key]
    out: list[float] | None = None
    try:
        f, big = _open(path)
        if f is not None:
            with f:
                width, chans, total = f.getsampwidth(), f.getnchannels(), f.getnframes()
                if total > 0 and width in (1, 2, 3, 4):
                    step = max(1, total // bars)
                    vals = []
                    for i in range(bars):
                        start = i * step
                        if start >= total:
                            vals.append(0.0)
                            continue
                        f.setpos(start)
                        a = _to16(f.readframes(min(_RUN, step)), width, big)
                        vals.append(max((abs(x) for x in a), default=0) / 32768 if chans else 0.0)
                    top = max(vals) or 1.0
                    out = [round(v / top, 3) for v in vals]
    except (wave.Error, EOFError, OSError, ValueError, getattr(aifc, "Error", ValueError)):
        out = None
    _cache[key] = out
    return out
