"""Is an audio file a stem (one part of a song: the kick, the vocals) rather than the
whole song? Backups lists stems apart from songs; Uploader never lists or posts them.

Shared by both apps: this file is kept byte-identical in Backups (ablebackup/stems.py)
and Uploader (lazyupload/stems.py). Names and folders only; the file is never opened.
"""
import re
from pathlib import Path

# Words that name one part of a song. A render whose name adds one of these to the
# song's name ("Night Drive Kick", "Night Drive - Vocals") is a stem.
PARTS = {
    "kick", "kicks", "snare", "snares", "clap", "claps", "hat", "hats", "hihat", "hihats",
    "perc", "percs", "percussion", "drum", "drums", "bass", "sub", "808", "808s", "vox",
    "vocal", "vocals", "voc", "acapella", "acappella", "adlib", "adlibs", "synth", "synths",
    "lead", "leads", "pad", "pads", "keys", "piano", "rhodes", "organ", "chord", "chords",
    "arp", "pluck", "plucks", "guitar", "gtr", "strings", "brass", "horns", "fx", "sfx",
    "riser", "risers", "impact", "atmos", "atmosphere", "ambience", "texture", "shaker",
    "ride", "crash", "cymbal", "tom", "toms", "top", "tops", "bus", "group", "return",
    "reverb", "delay", "choir", "bells", "flute", "sax", "melody", "stem", "stems", "audio",
    "midi", "insert",
}
# Words that make it a version of the whole song instead ("Night Drive Bass Edit").
SONG = {
    "mix", "remix", "master", "mastered", "edit", "version", "dub", "extended", "instrumental",
    "radio", "club", "vip", "bootleg", "rework", "demo", "full", "final", "reprise", "live",
    "mixdown", "bounce", "render", "export",
}
STEM_DIR = re.compile(r"stems?\b|multi[\s_-]?tracks?|individual", re.I)
# Ableton's "Song 3-Kick" for each track it exports on its own.
_ABLETON_PART = re.compile(r"\s\d{1,3}-([A-Za-z]\w*)")
# FL Studio's "Song_Insert 3" for each mixer insert.
_FL_INSERT = re.compile(r"(?:^|[\s_-])insert[\s_-]*\d{1,3}\s*$", re.I)
# Where a name splits into song and part: "Song - Kick", "Song (Vocals)", "Song [Bass]",
# and "Night Drive_Kick" (an underscore only when the name also has spaces, so
# "Feel_The_Bass" stays one title).
_SPLIT = re.compile(r"\s+[-–—]\s+|[(\[]")


def words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s.lower())


def _in_stems_folder(path: Path, root: Path | None) -> bool:
    try:
        rel = path.parent.relative_to(root) if root else Path(path.parent.name)
    except ValueError:
        rel = Path(path.parent.name)
    return any(STEM_DIR.search(part) for part in rel.parts)


def _only_parts(text: str) -> bool:
    """Every word is a part word or a number, with at least one part word: "Kick",
    "02 Vocals", "Bass 2"."""
    ws = words(text)
    return any(w in PARTS for w in ws) and all(w in PARTS or w.isdigit() for w in ws)


def is_stem(path: Path, root: Path | None = None, project: str = "") -> bool:
    """True when an audio file is one part of a song rather than the whole song. It
    sits in a folder called "Stems" (or "Multitracks") below `root`; or it has
    Ableton's "Song 3-Kick" or FL Studio's "Song_Insert 3" naming; or its name adds
    a part ("Kick", "Vocals") to the song's name. `project`, the song's project name
    when known, lets "Night Drive Kick" count; without it the part must stand apart
    ("Night Drive - Kick") so titles like "Deep Bass" stay songs."""
    path = Path(path)
    if _in_stems_folder(path, root):
        return True
    name = path.stem
    ws = words(name)
    rest = list(ws)
    for w in words(project):
        if w in rest:
            rest.remove(w)
    if project and not rest:
        return False  # the song itself, even one called "Bass"
    if any(w in SONG for w in rest):
        return False
    m = _ABLETON_PART.search(name)
    if m and m.group(1).lower() != "step":  # "Garage 2-Step" is a song
        return True
    if _FL_INSERT.search(name):
        return True
    if _only_parts(name):
        return True
    if rest != ws and any(w in PARTS for w in rest):
        return True
    pieces = _SPLIT.split(name)
    if len(pieces) < 2 and " " in name and "_" in name:
        pieces = name.rsplit("_", 1)
    return len(pieces) > 1 and _only_parts(pieces[-1].strip(" )]_-"))


def stem_folder_name(path: Path, root: Path) -> str | None:
    """For a file inside a stems folder in an exports folder, the song name that
    folder carries: "Night Drive Stems/Kick.wav" -> "Night Drive", and
    "Night Drive/Stems/Kick.wav" -> "Night Drive"."""
    try:
        parts = path.parent.relative_to(root).parts
    except ValueError:
        return None
    for i in range(len(parts) - 1, -1, -1):
        if STEM_DIR.search(parts[i]):
            rest = STEM_DIR.sub(" ", parts[i])
            rest = re.sub(r"[\s_-]+", " ", rest).strip(" -_")
            if len(rest) >= 3:
                return rest
            if i > 0:
                return parts[i - 1]
            return None
    return None
