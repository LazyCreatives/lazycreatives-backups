"""The clues used to tell which project an exported song came from, beyond its plain
name: extra ways of reading a file name (an artist name or date in front, words run
together, a slip of spelling), whether a file is a stem rather than a whole song,
and when the project was saved compared with when the song was exported.

Everything here is pure and quick; :mod:`ablebackup.exports` decides how far to
trust each clue.
"""
import re
from datetime import datetime
from pathlib import Path

# Telling a stem (one part of a song) from a whole song lives in ablebackup.stems,
# shared word for word with Uploader so both apps agree. Re-exported here because
# this is where the rest of the matching clues are.
from .stems import is_stem, stem_folder_name  # noqa: F401

# ---- other ways of reading a file name ----------------------------------------
_DASH = re.compile(r"\s+[-–—]\s+")
_TRACK_NO = re.compile(r"^\s*\d{1,2}\s*[.)_-]?\s+(?=\S)")


def name_variants(stem: str) -> list[str]:
    """Other readings of a render's name, in the order to try them, without the
    name itself: with the part before " - " dropped ("Robert - Night Drive"), and
    with a leading track number dropped ("01 Night Drive")."""
    out: list[str] = []
    parts = _DASH.split(stem, maxsplit=1)
    if len(parts) == 2 and parts[1].strip():
        out.append(parts[1])
    no_num = _TRACK_NO.sub("", stem, count=1)
    if no_num != stem and no_num.strip():
        out.append(no_num)
    return out


def squash(key: str) -> str:
    """A normalized name with its spaces taken out, so "NightDrive" meets "night drive"."""
    return key.replace(" ", "")


def close_spelling(a: str, b: str) -> bool:
    """True when two normalized names differ by a slip of the keyboard: one letter
    for names of 5-9 letters, two for longer ones. Short names never count."""
    a, b = squash(a), squash(b)
    n = min(len(a), len(b))
    if n < 5 or a == b:
        return False
    limit = 1 if n < 10 else 2
    if abs(len(a) - len(b)) > limit:
        return False
    return _distance(a, b, limit) <= limit


def _distance(a: str, b: str, limit: int) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > limit:
            return limit + 1
        prev = cur
    return prev[-1]


# ---- when things were saved ----------------------------------------------------
def snapshot_time(ts: str | None) -> float | None:
    """A backup's timestamp ("2026-10-01_1200") as seconds."""
    if not ts:
        return None
    for fmt in ("%Y-%m-%d_%H%M%S", "%Y-%m-%d_%H%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(ts, fmt).timestamp()
        except ValueError:
            continue
    return None


def nearest(times: list[float], t: float) -> float | None:
    """How many seconds from ``t`` to the closest of ``times``."""
    return min((abs(x - t) for x in times), default=None)


def minutes_text(secs: float) -> str:
    m = round(secs / 60)
    if m < 2:
        return "a minute"
    if m < 90:
        return f"{m} minutes"
    return f"{round(m / 60)} hours"


# Names too plain to learn from: linking "Untitled.wav" by hand says nothing about
# the next "Untitled 3.wav".
GENERIC = {"untitled", "master", "mix", "final", "export", "bounce", "audio", "track",
           "song", "new", "render", "mixdown", "demo", "idea", "beat", "loop", "test",
           "new song", "untitled song", "new project", "untitled project"}


# ---- what a Reaper project says about its renders -------------------------------
_RPP_LINE = re.compile(r"^\s*(RENDER_FILE|RENDER_PATTERN)\s+(.*?)\s*$")
_AUDIO_SUFFIX = re.compile(r"\.(wav|aiff?|flac|mp3|ogg|opus|m4a|wma|aac)$", re.I)


def _rpp_value(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] in "\"'`" and raw[-1] == raw[0]:
        return raw[1:-1]
    return raw


def reaper_render(project_file, project_name: str) -> tuple[Path, str] | None:
    """Where a Reaper project renders its songs and what it calls them, from the
    RENDER_FILE (folder or file) and RENDER_PATTERN (name with $project etc.) lines
    of its .rpp. None when it renders to the project folder under its own name,
    which is covered anyway, or the file can't be read."""
    path = Path(project_file)
    vals: dict[str, str] = {}
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for i, line in enumerate(f):
                m = _RPP_LINE.match(line)
                if m:
                    vals[m.group(1)] = _rpp_value(m.group(2))
                if len(vals) == 2 or i > 400:  # both sit near the top of the file
                    break
    except OSError:
        return None
    target, pattern = vals.get("RENDER_FILE", ""), vals.get("RENDER_PATTERN", "")
    folder, name = path.parent, project_name
    if target:
        t = Path(target)
        if not t.is_absolute():
            t = path.parent / t
        if _AUDIO_SUFFIX.search(t.name):
            folder, name = t.parent, t.stem
        else:
            folder = t
    if pattern:
        name = re.sub(r"\$project", project_name, pattern, flags=re.I)
        name = re.sub(r"\$[a-z]+", " ", name, flags=re.I)  # $track, $date… vary per file
        name = re.sub(r"\s+", " ", name).strip(" -_") or project_name
    if folder == path.parent and name == project_name:
        return None
    return folder, name
