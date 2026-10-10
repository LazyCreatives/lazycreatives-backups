"""Is an audio file in an exports folder a sample rather than a song? Splice packs,
one-shots, loops and bits you resampled inside a project end up next to finished
songs; "Songs not matched yet" tucks them away under "Probably samples" instead of
asking which project each came from.

Read only: names, folders and, for WAV and AIFF, the few bytes of the header that
say how long the sound is. Nothing is ever changed.
"""
import re
import struct
from pathlib import Path

# Folders that hold samples rather than songs.
_SAMPLE_DIR = re.compile(
    r"^(splice|sounds|packs?|samples?|sample[\s_-]?packs?|one[\s_-]?shots?|loops?|kits?"
    r"|drum[\s_-]?kits?|processed|consolidate|freeze|crop|reverse|recorded|recordings"
    r"|resampl\w*|imported|presets?|user library|cymatics|loopmasters|output|kontakt)$",
    re.I)
# What sample names are made of: "OS_ATL_kick_subby", "CYM_808_Loop_140_Fmin",
# "Hihat 01", "vocal chop 3", "Resampling 2", "1-Audio 0001 [2026-10-08 195233]".
_SAMPLE_WORDS = {
    "kick", "kicks", "snare", "snares", "clap", "claps", "hat", "hats", "hihat", "hh",
    "oh", "ch", "openhat", "closedhat", "perc", "percs", "shaker", "rim", "rimshot",
    "tom", "toms", "crash", "ride", "cymbal", "fill", "fills", "808", "sub", "oneshot",
    "shot", "loop", "loops", "fx", "sfx", "riser", "impact", "downlifter", "uplifter",
    "sweep", "whoosh", "stab", "chop", "chops", "vox", "foley", "texture", "noise",
    "snap", "tamb", "bell", "pluck", "hit", "drumloop", "toploop", "resampling",
    "resample", "resampled", "freeze", "consolidated", "audio",
}
_PACK_CODE = re.compile(r"^[A-Z0-9]{2,6}_")              # "OS_", "CYM_", "SS2_"
_ABLETON_CLIP = re.compile(r"\[\d{4}-\d\d-\d\d \d{6}\]")  # recorded or consolidated clip
_ABLETON_TRACK = re.compile(r"^\d{1,3}-(audio|midi|\w+) \d{4}", re.I)  # "1-Audio 0001"
_SHORT = 20.0  # seconds: a song is longer than this


def seconds(path: Path) -> float | None:
    """How long a WAV or AIFF file plays, from its header; None for other kinds."""
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
                return _wav(f)
            if head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
                return _aiff(f)
    except OSError:
        pass
    return None


def _wav(f) -> float | None:
    rate = align = None
    for _ in range(64):
        h = f.read(8)
        if len(h) < 8:
            return None
        cid, size = h[:4], struct.unpack("<I", h[4:])[0]
        if cid == b"fmt ":
            body = f.read(size)
            if len(body) < 16:
                return None
            rate, align = struct.unpack("<I", body[4:8])[0], struct.unpack("<H", body[12:14])[0]
        elif cid == b"data":
            return size / (rate * align) if rate and align else None
        else:
            f.seek(size, 1)
        if size % 2:
            f.seek(1, 1)
    return None


def _ext_float(b: bytes) -> float:
    exp = ((b[0] & 0x7F) << 8) | b[1]
    mant = int.from_bytes(b[2:10], "big")
    return 0.0 if exp == 0 and mant == 0 else mant * 2.0 ** (exp - 16383 - 63)


def _aiff(f) -> float | None:
    for _ in range(64):
        h = f.read(8)
        if len(h) < 8:
            return None
        cid, size = h[:4], struct.unpack(">I", h[4:])[0]
        if cid == b"COMM":
            body = f.read(size)
            if len(body) < 18:
                return None
            frames = struct.unpack(">I", body[2:6])[0]
            rate = _ext_float(body[8:18])
            return frames / rate if rate else None
        f.seek(size + (size % 2), 1)
    return None


def _words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s.lower())


def sample_reason(path: Path, root: Path | None = None, size: int | None = None) -> str | None:
    """Plain words for why a file looks like a sample, or None when it looks like a song."""
    try:
        rel = path.parent.relative_to(root).parts if root else ()
    except ValueError:
        rel = ()
    for part in rel:
        if _SAMPLE_DIR.match(part.strip()):
            return f"it's in a “{part}” folder"
    name = path.stem
    if _ABLETON_CLIP.search(name) or _ABLETON_TRACK.match(name):
        return "named like a clip recorded or resampled in a project"
    ws = _words(name)
    sample_words = [w for w in ws if w in _SAMPLE_WORDS]
    if _PACK_CODE.match(name) and "_" in name[3:] and sample_words:
        return "named like a sample from a pack"
    secs = seconds(path)
    if secs is None and size is not None and path.suffix.lower() in (".mp3", ".m4a", ".ogg", ".opus", ".aac"):
        secs = size / 40_000  # at most 320 kbps
    if secs is not None and secs < _SHORT:
        return f"only {max(1, round(secs))} seconds long"
    if sample_words and all(w in _SAMPLE_WORDS or w.isdigit() or len(w) <= 2 for w in ws) \
            and "_" in name:
        return "named like a sample"
    return None


# Bits of a project rendered to audio inside it, not songs: FL's "SOFT (consolidated)",
# a synth bounced on its own ("Serum_x64 #2"), "Pattern 3", "Insert 4", "Audio Track 2".
_PART_WORDS = re.compile(r"\b(consolidated|consolidate|frozen|freeze|resampled|resampling|bounce in place)\b", re.I)
_PART_NAME = re.compile(
    r"^(pattern|insert|track|audio( track)?|midi( track)?|clip|channel|bus|send|return|sampler|slicer"
    r"|serum|vital|sylenth1?|massive( x)?|kontakt|sytrus|flex|harmor|harmless|3x ?osc|omnisphere|diva"
    r"|pigments|phase ?plant|spire|nexus|keyscape|battery|fpc|directwave|fruity \w+|operator|wavetable"
    r"|simpler|drum rack|analog|electric|tension|collision|drift|meld|ana ?2|zebra2?|hive|dune ?3?"
    r"|surge( xt)?|retrologue|halion|kick ?2|trilian|addictive drums|superior drummer|ez ?drummer)"
    r"( ?x64| ?vst3?)?( ?#?\d+)?$", re.I)
# Folders anywhere on the way to a file that only ever hold other people's sounds.
_PACK_DIR = re.compile(r"^(splice|samples?|sample[\s_-]?packs?|packs?|one[\s_-]?shots?|loops?|drum[\s_-]?kits?"
                       r"|cymatics|loopmasters|user library)$", re.I)
_TAIL = re.compile(r"\s*(\((consolidated|copy|\d+)\)|#\d+|_x64|\bx64)\s*$", re.I)


def album_skip(path: Path, root: Path | None = None, project: str = "") -> str | None:
    """Plain words for why an export isn't a song to put on an album (a sample, or a
    part of a project rendered on its own), or None when it looks like a song. A song
    named like its project is always a song, even one called "Vital"."""
    for part in path.parent.parts:
        if _PACK_DIR.match(part.strip()):
            return f"it's in a “{part}” folder"
    try:
        size = path.stat().st_size
    except OSError:
        size = None
    why = sample_reason(path, root, size)
    if why:
        return why
    name = path.stem.replace("_", " ").strip()
    if _PART_WORDS.search(name):
        return "a part of a project rendered on its own"
    bare = name
    for _ in range(3):
        bare = _TAIL.sub("", bare).strip()
    if _PART_NAME.match(bare) and bare.lower() != project.replace("_", " ").strip().lower():
        return "named like one instrument or pattern, not a song"
    return None


_lengths: dict[tuple, float | None] = {}


def seconds_cached(path: Path) -> float | None:
    """`seconds`, remembered until the file changes (the album song list asks often)."""
    try:
        st = path.stat()
    except OSError:
        return None
    key = (str(path), st.st_mtime, st.st_size)
    if key not in _lengths:
        if len(_lengths) > 20000:
            _lengths.clear()
        _lengths[key] = seconds(path)
    return _lengths[key]
