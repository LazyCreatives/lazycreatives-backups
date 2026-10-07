"""Making (nearly) every audio file playable in the app's own player.

The player inside the app is Chromium's. It plays MP3, AAC / M4A, FLAC, Ogg, Opus and
ordinary WAVs, but not AIFF, Apple Lossless, CAF, WMA, AC-3, WavPack, Monkey's Audio,
DSD, 64-bit or compressed WAVs and a few more. For those, the ffmpeg that ships inside
the app reads the file and decodes it into memory, and the player is handed that.
Nothing is ever written to disk: the original file is only read, and no copy of it
is made anywhere.

This file is the same in Backups and Uploader (it imports nothing from either app).
"""
from __future__ import annotations

import mimetypes
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
from collections import OrderedDict
from pathlib import Path

from starlette.responses import FileResponse, Response

# Played straight from the file. M4A and WAV are checked inside first (see `_native`).
NATIVE_EXTS = {".mp3", ".flac", ".ogg", ".oga", ".opus", ".aac", ".webm", ".weba"}
MP4_EXTS = {".m4a", ".mp4", ".m4b"}
WAV_EXTS = {".wav", ".wave"}

MEMORY_LIMIT = 400 * 1024 ** 2  # decoded songs kept in memory, oldest dropped first
TIMEOUT = 300                   # seconds decoding one song may take

_decoded: OrderedDict[tuple, bytes] = OrderedDict()
_locks: dict[tuple, threading.Lock] = {}
_guard = threading.Lock()
_ffmpeg: list[str | None] = []


class CannotPlay(Exception):
    """The file couldn't be read or decoded."""


def ffmpeg() -> str | None:
    """The ffmpeg that ships with the app, else one installed on the computer."""
    if _ffmpeg:
        return _ffmpeg[0]
    found = os.environ.get("LAZY_FFMPEG") or None
    if not found:
        try:
            import imageio_ffmpeg
            found = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            found = None
    if not found:
        found = shutil.which("ffmpeg")
        for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
            if not found and os.path.isfile(p):
                found = p
    _ffmpeg.append(found)
    return found


def _wav_native(f) -> bool:
    """Chromium plays WAVs holding 8/16/24/32-bit whole numbers or 32-bit floats."""
    head = f.read(12)
    if len(head) < 12 or head[:4] not in (b"RIFF", b"RF64") or head[8:12] != b"WAVE":
        return False
    while True:
        h = f.read(8)
        if len(h) < 8:
            return False
        cid, size = h[:4], struct.unpack("<I", h[4:])[0]
        if cid != b"fmt ":
            f.seek(size + (size & 1), 1)
            continue
        fmt = f.read(min(size, 40))
        if len(fmt) < 16:
            return False
        tag, _ch, _rate, _bps, _align, bits = struct.unpack("<HHIIHH", fmt[:16])
        if tag == 0xFFFE and len(fmt) >= 26:  # "extensible": the real format is further in
            tag = struct.unpack("<H", fmt[24:26])[0]
        return (tag == 1 and bits in (8, 16, 24, 32)) or (tag == 3 and bits == 32)


def _mp4_native(f) -> bool:
    """M4A holding AAC (or FLAC / Opus) plays; Apple Lossless and AC-3 inside don't."""
    end = os.fstat(f.fileno()).st_size
    pos = 0
    while pos + 8 <= end:
        f.seek(pos)
        h = f.read(8)
        size, kind = struct.unpack(">I", h[:4])[0], h[4:]
        hdr = 8
        if size == 1:
            size, hdr = struct.unpack(">Q", f.read(8))[0], 16
        elif size == 0:
            size = end - pos
        if size < hdr:
            return False
        if kind == b"moov":
            box = f.read(min(size - hdr, 16 * 1024 * 1024))
            if b"alac" in box or b"ac-3" in box or b"ec-3" in box:
                return False
            return b"mp4a" in box or b"fLaC" in box or b"Opus" in box
        pos += size
    return False


def native(path: str) -> bool:
    """True when the app's player can play this file as it is."""
    ext = Path(path).suffix.lower()
    if ext in NATIVE_EXTS:
        return True
    try:
        with open(path, "rb") as f:
            if ext in WAV_EXTS:
                return _wav_native(f)
            if ext in MP4_EXTS:
                return _mp4_native(f)
    except (OSError, struct.error):
        return False
    return False


def _key(path: str) -> tuple:
    st = os.stat(path)
    return (os.path.realpath(path), st.st_size, st.st_mtime_ns)


def _fix_wav_sizes(wav: bytes) -> bytes:
    """ffmpeg writing to a pipe can't go back to fill in the sizes; fill them in."""
    if wav[:4] != b"RIFF" or wav[8:12] != b"WAVE":
        return wav
    buf = bytearray(wav)
    buf[4:8] = struct.pack("<I", min(len(buf) - 8, 0xFFFFFFFF))
    pos = 12
    while pos + 8 <= len(buf):
        cid, size = bytes(buf[pos:pos + 4]), struct.unpack("<I", buf[pos + 4:pos + 8])[0]
        if cid == b"data":
            buf[pos + 4:pos + 8] = struct.pack("<I", min(len(buf) - pos - 8, 0xFFFFFFFF))
            break
        pos += 8 + size + (size & 1)
    return bytes(buf)


def decode(path: str) -> bytes:
    """`path` as a plain 24-bit WAV, in memory, for the player."""
    try:
        key = _key(path)
    except OSError as e:
        raise CannotPlay(str(e)) from None
    with _guard:
        if key in _decoded:
            _decoded.move_to_end(key)
            return _decoded[key]
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        with _guard:
            if key in _decoded:
                return _decoded[key]
        exe = ffmpeg()
        if not exe:
            raise CannotPlay("no decoder")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
        # First audio track only (no cover pictures), written to ffmpeg's output pipe,
        # never to a file.
        try:
            r = subprocess.run([exe, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
                                "-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", "pcm_s24le",
                                "-f", "wav", "pipe:1"],
                               stdin=subprocess.DEVNULL, capture_output=True, timeout=TIMEOUT,
                               creationflags=flags)
        except (OSError, subprocess.TimeoutExpired):
            raise CannotPlay("couldn't decode this file") from None
        if r.returncode != 0 or len(r.stdout) <= 44:
            raise CannotPlay("couldn't decode this file")
        wav = _fix_wav_sizes(r.stdout)
        with _guard:
            _decoded[key] = wav
            _locks.pop(key, None)
            total = sum(len(v) for v in _decoded.values())
            while total > MEMORY_LIMIT and len(_decoded) > 1:
                total -= len(_decoded.popitem(last=False)[1])
        return wav


_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


def wav_response(data: bytes, range_header: str | None) -> Response:
    """Serve decoded audio, honouring the player's requests for a part of it (seeking)."""
    size = len(data)
    head = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    m = _RANGE.match((range_header or "").strip())
    if not m or (not m.group(1) and not m.group(2)):
        return Response(data, media_type="audio/wav", headers=head)
    if m.group(1):
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else size - 1
    else:  # the last N bytes
        start, end = max(0, size - int(m.group(2))), size - 1
    end = min(end, size - 1)
    if start >= size or start > end:
        return Response(status_code=416, headers={**head, "Content-Range": f"bytes */{size}"})
    head["Content-Range"] = f"bytes {start}-{end}/{size}"
    return Response(data[start:end + 1], status_code=206, media_type="audio/wav", headers=head)


def response(path: str, range_header: str | None = None, force: bool = False,
             media_type: str | None = None) -> Response:
    """What the player gets for `path`: the file itself when it can play it, else the
    file decoded in memory. `force` decodes even a file that looks playable (the app
    asks again this way when the player turned one down). Raises CannotPlay only
    when asked to decode; otherwise a file that won't decode is handed over as it is,
    for the player to try."""
    if force or not native(path):
        try:
            return wav_response(decode(path), range_header)
        except CannotPlay:
            if force:
                raise
    return FileResponse(path, media_type=media_type or mimetypes.guess_type(path)[0]
                        or "application/octet-stream")
