"""Heuristic genre guesser — a playful, CORRECTABLE tag, not ground truth.

BPM is the backbone (genre tracks tempo closely); keyword hits in the project name
and in the gathered sample filenames disambiguate overlapping tempo ranges. A name
keyword counts more than a sample keyword (sample packs use generic genre words).
Returns the best guess plus a confidence so the UI can say "Boom bap" vs "maybe DnB?".
"""
import re


def _has_kw(kw: str, text: str) -> bool:
    # Word-boundary match so "house" doesn't fire on "penthouse"/"warehouse".
    return re.search(r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])", text) is not None

# (genre, emoji, bpm_lo, bpm_hi, keywords). Ranges overlap on purpose — keywords break ties.
_GENRES = [
    ("Lo-fi",      "🌧",  60, 90,  ["lofi", "lo-fi", "lo fi", "tape", "cassette", "dusty", "vinyl crackle"]),
    ("Boom bap",   "🎤", 82, 95,  ["boombap", "boom bap", "boom_bap", "boombap", "amen", "jazzy", "sample chop"]),
    ("Hip hop",    "🎤", 80, 102, ["hiphop", "hip hop", "hip-hop", "rap", "trap soul", "rnb", "r&b"]),
    ("Trap",       "🔥", 130, 156, ["trap", "808", "hi hat roll", "hihat roll", "triplet", "gunshot"]),
    ("Drill",      "🗡",  138, 150, ["drill", "uk drill", "sliding 808", "slide 808"]),
    ("Phonk",      "💀", 120, 150, ["phonk", "cowbell", "memphis", "drift"]),
    ("House",      "🏠", 118, 128, ["house", "deep house", "disco", "soulful", "filter house"]),
    ("Tech house", "🎛",  122, 128, ["tech house", "tech_house", "techhouse"]),
    ("Techno",     "⚙",  127, 140, ["techno", "industrial", "hypnotic", "warehouse", "acid"]),
    ("Trance",     "🌀", 132, 142, ["trance", "supersaw", "uplifting", "psy", "goa"]),
    ("UK garage",  "🇬🇧", 128, 136, ["garage", "ukg", "2-step", "2 step", "speed garage"]),
    ("Grime",      "📻", 138, 142, ["grime", "eski", "square bass"]),
    ("Dubstep",    "🛸", 138, 146, ["dubstep", "wobble", "wub", "growl", "riddim", "brostep"]),
    ("DnB",        "🥁", 160, 178, ["dnb", "d&b", "drum and bass", "drum & bass", "reese", "neurofunk", "liquid"]),
    ("Jungle",     "🌴", 155, 176, ["jungle", "ragga", "amen break"]),
    ("Hardstyle",  "🔨", 145, 160, ["hardstyle", "rawstyle", "kick lead"]),
    ("Hyperpop",   "✨", 140, 175, ["hyperpop", "glitchcore", "pitched vocal"]),
    ("Pop",        "🎙",  100, 130, ["pop", "topline", "chorus", "verse", "radio edit"]),
    ("Ambient",    "🌌", 1, 110,  ["ambient", "drone", "soundscape", "atmos", "cinematic", "field rec"]),
]

_NEUTRAL = {"genre": None, "emoji": "🎵", "confidence": 0.0, "alternatives": []}
_EMOJI = {g: e for g, e, *_ in _GENRES}


def emoji_for(genre: str | None) -> str:
    return _EMOJI.get(genre, "🎵")


def guess_genre(name: str, bpm: float | None, sample_names=()) -> dict:
    """Return {genre, emoji, bpm, confidence, alternatives}. genre is None when there
    isn't enough signal. Confidence reflects EVIDENCE QUALITY: a genre word in the
    project name is near-certain (the producer said so); a sample-name word is
    medium; a bare BPM band is a low-confidence guess (tempos overlap)."""
    name_l = (name or "").lower()
    samp_l = " ".join(sample_names).lower()
    bpm_r = round(bpm) if bpm else None

    scored = []  # (score, has_name_kw, has_sample_kw, genre, emoji)
    for genre, emoji, lo, hi, kws in _GENRES:
        s = 0.0
        if bpm_r is not None:
            if lo <= bpm_r <= hi:
                s += 2.0
            elif lo - 5 <= bpm_r <= hi + 5:
                s += 0.7
        name_kw = samp_kw = False
        for kw in kws:
            if _has_kw(kw, name_l):
                s += 6.0
                name_kw = True
            if _has_kw(kw, samp_l):
                s += 1.5
                samp_kw = True
        if s > 0:
            scored.append((s, name_kw, samp_kw, genre, emoji))

    if not scored:
        return {**_NEUTRAL, "bpm": bpm_r}
    scored.sort(key=lambda r: r[0], reverse=True)
    score, name_kw, samp_kw, genre, emoji = scored[0]
    second = scored[1][0] if len(scored) > 1 else 0.0

    base = 0.85 if name_kw else 0.6 if samp_kw else 0.35  # quality of the winning signal
    margin = (score - second) / score                     # how clearly it beat #2
    confidence = round(min(0.97, base + margin * 0.12), 2)
    return {
        "genre": genre,
        "emoji": emoji,
        "bpm": bpm_r,
        "confidence": confidence,
        "alternatives": [g for _s, _n, _k, g, _e in scored[1:3]],
    }
