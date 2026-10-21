"""Clean names from file names: "glasshouse_final_v3 (2)" -> "Glasshouse".

SHARED FILE: the same file lives in Backups (backend/ablebackup/names.py) and
Uploader (backend/lazyupload/names.py). Keep the two byte-identical.

Only works out names; it never renames a file. Backups' Tidy names uses
`song_base` for the name it suggests before adding "v1", "v2"; albums and
Uploader's suggested SoundCloud title use `song_title`.

What goes: dates ("2026-10-03"), tempos and keys ("124bpm Fmin"), copy numbers
("(2)", "(copy)", "(Autosaved 4)"), underscores and dots between words, and the
words on the end that only say which save or render it was ("final", "v3",
"master", "mixdown"). "New" stays: it is too often part of a title ("Brand New").
Capitals are fixed only when the whole name is in small
letters or ALL CAPITALS; any other mix is the person's own and stays.
"""
import re

# Words that only say "which save this was".
NOISE = re.compile(r"^(v\d+|\d+|final|finished|done|latest|copy|autosaved|"
                   r"export(ed)?|render(ed)?|bounce[d]?|wip|draft|version)$", re.I)
# Words that say "which render this was". Dropped from the end of a name, but kept
# as what an export adds to its project's name ("Glasshouse v2 (master)").
RENDER_WORDS = re.compile(r"^(master(ed)?|mixdown|mix-down)$", re.I)

# Dates, tempos and keys people put in names: "2026-10-01 Night Drive",
# "Night Drive 07.10.26", "Night Drive 124bpm Amin", "Sunset (128 BPM) F#m".
# The same rules Backups uses to link exports to projects (exports.py).
_DATES = re.compile(r"\b(?:19|20)\d\d[-_. ]?[01]\d[-_. ]?[0-3]\d\b"
                    r"|\b[0-3]?\d[-_.][01]?\d[-_.](?:19|20)?\d\d\b")
_KEY = r"[a-g](?:#|b|sharp|flat)?\s?(?:maj(?:or)?|min(?:or)?|m)?"
_TEMPO = re.compile(rf"\b\d{{2,3}}\s*bpm\b(?:[\s_-]*{_KEY}\b)?|\bbpm\s*\d{{2,3}}\b"
                    r"|\b[a-g](?:#|b)?(?:maj|min)\s*$", re.I)
# A key on the end without a tempo only in its short form ("Amin", "F#maj"), so
# "Prelude in C Major" keeps its key. A short key on the end ("F#m", "Ebm") only with its sharp or flat, so "Who I Am"
# keeps its last word.
_SHORT_KEY = re.compile(r"\s[A-Ga-g](?:#|b)m\s*$")
_TAIL = (r"(?:v\d+|final|finished|done|latest|copy|export(?:ed)?|render(?:ed)?|"
         r"bounced?|wip|draft|version|master(?:ed)?|mixdown|mix-down)")
# "(master)", "[final mix]"-style brackets holding only render words
_RENDER_BRACKETS = re.compile(rf"[\[(]\s*{_TAIL}(?:\s+{_TAIL})*\s*[\])]", re.I)


def words(s: str) -> list[str]:
    """A name's words, without dates, tempos, keys and copy numbers."""
    s = re.sub(r"\(autosaved[^)]*\)", " ", s or "", flags=re.I)
    s = re.sub(r"[\[(]\s*(\d{1,4}\s*(bpm)?|copy)\s*[\])]", " ", s, flags=re.I)  # (2), [124], (copy)
    s = _DATES.sub(" ", s)
    for _ in range(2):  # "124bpm Fmin" then whatever was before it on the end
        s = _SHORT_KEY.sub(" ", _TEMPO.sub(" ", s.strip()))
    s = re.sub(r"(?<=[^\W\d_])\.(?=[^\W\d_])", " ", s)  # night.drive
    return [w for w in re.split(r"[\s_]+", s) if w]


def fix_capitals(s: str) -> str:
    """A name typed all in small letters or ALL IN CAPITALS gets a capital at the start
    of each word ("night drive" -> "Night Drive"); anything else stays as written."""
    letters = [c for c in s if c.isalpha()]
    if re.fullmatch(r"[^\W\d_]{1,4}", s.strip()) and s.isupper():
        return s  # one short word in capitals is most likely meant that way: "DNA", "SOS"
    if not letters or not (all(c.islower() for c in letters) or all(c.isupper() for c in letters)):
        return s
    return re.sub(r"[^\W\d_][^\s\-]*", lambda m: m.group(0)[0].upper() + m.group(0)[1:].lower(), s)


def has_own_capitals(s: str) -> bool:
    """Written with a mix of capitals and small letters: the person's own spelling."""
    return s != s.lower() and s != s.upper()


def base_words(name: str) -> str:
    """The name without dates, copy numbers and every version word on the end, any
    number included ("Glasshouse FINAL 3" -> "Glasshouse"), capitals as written."""
    ws = words(name)
    while ws and (NOISE.match(ws[-1]) or RENDER_WORDS.match(ws[-1]) or ws[-1] in ("-", "–")):
        ws.pop()
    if len(ws) > 1 and ws[-1].lower() == "project":  # "Sunrise Project" folder
        ws.pop()
    return " ".join(ws).strip(" -_–")


def song_base(name: str) -> str:
    """The song's name a project's versions share, before "v1", "v2" are added:
    "night_drive 124bpm Fmin 2026-10-03 (2)" -> "Night Drive". Never empty."""
    base = base_words(name)
    return fix_capitals(base) if base else (name or "").strip()


def song_title(name: str) -> str:
    """A tidy title for a song from its file name, for an album or SoundCloud:
    "glasshouse final 3 master" -> "Glasshouse", "Glasshouse v2 (master)" ->
    "Glasshouse". A number that may be part of the title stays ("Episode 101",
    "Freaky 3"); one after a version word goes ("final 3"). Never empty."""
    s = _RENDER_BRACKETS.sub(" ", name or "")
    ws = words(s)
    while ws:
        w = ws[-1]
        if re.fullmatch(r"\d+", w):
            if len(ws) > 1 and re.fullmatch(_TAIL, ws[-2], re.I):
                ws.pop()  # "final 3": the number goes with its word
                continue
            break
        if re.fullmatch(_TAIL, w, re.I) or w in ("-", "–"):
            ws.pop()
            continue
        break
    title = " ".join(ws).strip(" -_–")
    return fix_capitals(title) if title else (name or "").strip()
