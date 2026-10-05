"""Read the song title some exports carry inside the file (the "Title" a music
player shows). Only the title, and only from the file's opening tag area, so it is
quick even on a slow drive. Every reader gives up quietly on anything unexpected.

Covers: ID3 tags (MP3, and inside WAV/AIFF), WAV's own INFO name, AIFF's NAME,
FLAC and Ogg/Opus comments, and M4A/AAC titles.
"""
import struct
from pathlib import Path

_MAX = 1 << 20  # never read more than 1 MB of tag data


def title(path) -> str | None:
    """The title stored in the file, or None."""
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            f.seek(0)
            if head[:3] == b"ID3":
                t = _id3(f.read(_MAX))
            elif head[:4] == b"RIFF" and head[8:12] == b"WAVE":
                t = _riff(f)
            elif head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
                t = _aiff(f)
            elif head[:4] == b"fLaC":
                t = _flac(f)
            elif head[:4] == b"OggS":
                t = _ogg(f.read(65536))
            elif head[4:8] == b"ftyp":
                t = _mp4(f, Path(path).stat().st_size)
            else:
                t = None
    except (OSError, ValueError, struct.error, IndexError):
        return None
    t = (t or "").strip().strip("\x00").strip()
    return t or None


def _text(enc: int, raw: bytes) -> str:
    if enc == 0:
        return raw.split(b"\x00")[0].decode("latin-1")
    if enc == 1:
        return raw.decode("utf-16", errors="ignore").split("\x00")[0]
    if enc == 2:
        return raw.decode("utf-16-be", errors="ignore").split("\x00")[0]
    return raw.split(b"\x00")[0].decode("utf-8", errors="ignore")


def _syncsafe(b: bytes) -> int:
    return (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]


def _id3(data: bytes) -> str | None:
    if data[:3] != b"ID3" or len(data) < 10:
        return None
    ver = data[3]
    end = min(len(data), 10 + _syncsafe(data[6:10]))
    i = 10
    if ver == 2:
        while i + 6 <= end:
            fid, size = data[i:i + 3], int.from_bytes(data[i + 3:i + 6], "big")
            if not fid.strip(b"\x00") or size <= 0:
                return None
            if fid == b"TT2":
                body = data[i + 6:i + 6 + size]
                return _text(body[0], body[1:])
            i += 6 + size
        return None
    while i + 10 <= end:
        fid = data[i:i + 4]
        size = _syncsafe(data[i + 4:i + 8]) if ver >= 4 else int.from_bytes(data[i + 4:i + 8], "big")
        if not fid.strip(b"\x00") or size <= 0:
            return None
        if fid == b"TIT2":
            body = data[i + 10:i + 10 + size]
            return _text(body[0], body[1:])
        i += 10 + size
    return None


def _chunks(f, start: int, end: int, big: bool):
    """(id, offset, size) of each chunk between start and end."""
    pos = start
    fmt = ">I" if big else "<I"
    while pos + 8 <= end:
        f.seek(pos)
        hdr = f.read(8)
        if len(hdr) < 8:
            return
        cid, size = hdr[:4], struct.unpack(fmt, hdr[4:])[0]
        yield cid, pos + 8, size
        pos += 8 + size + (size & 1)


def _riff(f) -> str | None:
    f.seek(0, 2)
    end = f.tell()
    found = None
    for cid, off, size in _chunks(f, 12, end, big=False):
        if cid == b"LIST" and size <= _MAX:
            f.seek(off)
            body = f.read(size)
            if body[:4] == b"INFO":
                j = 4
                while j + 8 <= len(body):
                    sid, ssize = body[j:j + 4], struct.unpack("<I", body[j + 4:j + 8])[0]
                    if sid == b"INAM":
                        found = found or _text(0, body[j + 8:j + 8 + ssize])
                    j += 8 + ssize + (ssize & 1)
        elif cid in (b"id3 ", b"ID3 ") and size <= _MAX:
            f.seek(off)
            t = _id3(f.read(size))
            if t:
                return t
    return found


def _aiff(f) -> str | None:
    f.seek(0, 2)
    end = f.tell()
    found = None
    for cid, off, size in _chunks(f, 12, end, big=True):
        if cid == b"NAME" and size <= _MAX:
            f.seek(off)
            found = found or _text(0, f.read(size))
        elif cid in (b"ID3 ", b"id3 ") and size <= _MAX:
            f.seek(off)
            t = _id3(f.read(size))
            if t:
                return t
    return found


def _comments(body: bytes) -> str | None:
    """Vorbis-style comments: vendor string, then "KEY=value" entries."""
    n = struct.unpack("<I", body[:4])[0]
    j = 4 + n
    count = struct.unpack("<I", body[j:j + 4])[0]
    j += 4
    for _ in range(min(count, 200)):
        ln = struct.unpack("<I", body[j:j + 4])[0]
        entry = body[j + 4:j + 4 + ln].decode("utf-8", errors="ignore")
        j += 4 + ln
        k, _, v = entry.partition("=")
        if k.upper() == "TITLE":
            return v
    return None


def _flac(f) -> str | None:
    f.seek(4)
    for _ in range(64):
        hdr = f.read(4)
        if len(hdr) < 4:
            return None
        last, kind, size = hdr[0] & 0x80, hdr[0] & 0x7F, int.from_bytes(hdr[1:], "big")
        if kind == 4 and size <= _MAX:
            return _comments(f.read(size))
        f.seek(size, 1)
        if last:
            return None
    return None


def _ogg(data: bytes) -> str | None:
    for marker in (b"\x03vorbis", b"OpusTags"):
        i = data.find(marker)
        if i >= 0:
            return _comments(data[i + len(marker):])
    return None


def _mp4(f, end: int) -> str | None:
    def atoms(start: int, stop: int):
        pos = start
        while pos + 8 <= stop:
            f.seek(pos)
            hdr = f.read(8)
            if len(hdr) < 8:
                return
            size, kind = struct.unpack(">I", hdr[:4])[0], hdr[4:]
            head = 8
            if size == 1:
                size = struct.unpack(">Q", f.read(8))[0]
                head = 16
            elif size == 0:
                size = stop - pos
            if size < head:
                return
            yield kind, pos + head, pos + size
            pos += size

    def find(path: list[bytes], start: int, stop: int):
        for kind, s, e in atoms(start, stop):
            if kind == path[0]:
                if len(path) == 1:
                    return s, e
                if kind == b"meta":
                    s += 4  # meta is a "full box": 4 bytes of version/flags first
                return find(path[1:], s, e)
        return None

    hit = find([b"moov", b"udta", b"meta", b"ilst", b"\xa9nam", b"data"], 0, end)
    if not hit:
        return None
    s, e = hit
    if e - s > _MAX:
        return None
    f.seek(s + 8)  # data: 4 bytes type, 4 bytes locale
    return f.read(e - s - 8).decode("utf-8", errors="ignore")
