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
    ("Hip hop",    "🎤", 80, 102, ["hiphop", "hip hop", "hip-hop", "rap"]),
    ("Trap",       "🔥", 130, 156, ["trap", "808", "hi hat roll", "hihat roll", "triplet", "gunshot"]),
    ("Drill",      "🗡",  138, 150, ["drill", "ny drill", "sliding 808", "slide 808"]),
    ("Phonk",      "💀", 120, 150, ["phonk", "cowbell", "memphis", "drift"]),
    ("House",      "🏠", 118, 128, ["house", "soulful"]),
    ("Tech house", "🎛",  122, 128, ["tech house", "tech_house", "techhouse"]),
    ("Techno",     "⚙",  127, 140, ["techno", "industrial techno", "hypnotic", "warehouse", "acid"]),
    ("Trance",     "🌀", 132, 142, ["trance", "supersaw", "uplifting"]),
    ("UK garage",  "🇬🇧", 128, 136, ["garage", "ukg", "2-step", "2 step", "speed garage"]),
    ("Grime",      "📻", 138, 142, ["grime", "eski", "square bass"]),
    ("Dubstep",    "🛸", 138, 146, ["dubstep", "wobble", "wub", "growl", "brostep", "tearout"]),
    ("DnB",        "🥁", 160, 178, ["dnb", "d&b", "drum and bass", "drum & bass", "drum n bass", "reese"]),
    ("Jungle",     "🌴", 155, 176, ["jungle", "ragga", "amen break"]),
    ("Hardstyle",  "🔨", 145, 160, ["hardstyle", "rawstyle", "kick lead"]),
    ("Hyperpop",   "✨", 140, 175, ["hyperpop", "glitchcore", "pitched vocal"]),
    ("Pop",        "🎙",  100, 130, ["pop", "topline", "chorus", "verse", "radio edit"]),
    ("Ambient",    "🌌", 1, 110,  ["ambient", "drone", "soundscape", "atmos", "field rec"]),
]

# Genres added later (Backups 0.2.7). They are only guessed when the project's name or
# samples say so, or from your corrections, never from the tempo alone, so a bare-tempo
# guess stays what it always was. Their tempo range just settles ties once they are in play.
_NAMED_ONLY = [
    ("R&B",            "🕯",  60, 110, ["rnb", "r&b", "r'n'b", "randb", "trap soul", "slow jam"]),
    ("Deep house",     "🌊", 115, 124, ["deep house", "deephouse", "deep_house"]),
    ("Afro house",     "🪘",  118, 126, ["afro house", "afrohouse", "afro_house"]),
    ("Disco",          "🪩",  110, 128, ["disco", "boogie"]),
    ("Melodic techno", "🌙", 118, 128, ["melodic techno", "melodic_techno", "afterlife"]),
    ("Hard techno",    "🔩", 145, 165, ["hard techno", "hardtechno", "hard_techno", "schranz"]),
    ("Psytrance",      "🍄", 136, 148, ["psytrance", "psy", "goa", "full on"]),
    ("Breakbeat",      "💥", 120, 140, ["breakbeat", "big beat", "nu skool breaks"]),
    ("Future bass",    "🌈", 130, 160, ["future bass", "futurebass", "future_bass", "kawaii"]),
    ("Indie",          "🎸", 80, 150,  ["indie", "indie rock", "alt rock"]),
    ("Rock",           "🤘", 80, 170,  ["rock", "grunge", "guitar rock"]),
    ("Synthwave",      "🌆", 80, 118,  ["synthwave", "retrowave", "outrun", "darksynth"]),
    ("Afrobeats",      "🌍", 95, 115,  ["afrobeats", "afrobeat", "afro beat", "afropop", "naija"]),
    ("Amapiano",       "🎹", 108, 116, ["amapiano", "log drum", "log_drum", "logdrum"]),
    ("Reggaeton",      "🔊", 86, 100,  ["reggaeton", "dembow", "perreo"]),
    ("Dancehall",      "🌞", 88, 106,  ["dancehall", "riddim dancehall", "bashment"]),
    ("Downtempo",      "🍃", 70, 110,  ["downtempo", "chillout", "chill out"]),
    ("Cinematic",      "🎬", 1, 140,   ["cinematic", "soundtrack", "trailer", "orchestral", "film score"]),
    ("Jazz",           "🎷", 60, 200,  ["jazz", "bebop", "nu jazz"]),
    ("Liquid DnB",     "💧", 168, 176, ["liquid", "liquid dnb", "liquid funk"]),
    ("Neurofunk",      "🧠", 170, 176, ["neurofunk", "neuro"]),
    ("Jump up",        "🦘", 170, 176, ["jump up", "jumpup", "jump-up"]),
    ("Dancefloor DnB", "🪩",  172, 176, ["dancefloor dnb", "dancefloor", "dnb anthem"]),
    ("Rollers",        "🛞", 170, 176, ["rollers", "roller", "rolling dnb"]),
    ("Minimal DnB",    "🥁", 168, 176, ["minimal dnb", "minimal d&b", "minimal drum and bass"]),
    ("Techstep",       "⚙",  168, 176, ["techstep", "darkstep"]),
    ("Halftime",       "🐢", 80, 176,  ["halftime", "half time", "half-time"]),
    ("Drumstep",       "🥁", 170, 176, ["drumstep"]),
    ("UK drill",       "🗡",  138, 146, ["uk drill", "ukdrill", "uk_drill"]),
    ("Jerk",           "⚡", 140, 165, ["jerk", "jerk beat"]),
    ("Rage",           "🧨", 140, 170, ["rage", "rage beat"]),
    ("Plugg",          "🔌", 135, 160, ["plugg", "plug beat"]),
    ("Pluggnb",        "🔌", 130, 160, ["pluggnb", "plugg n b", "plugg rnb"]),
    ("Cloud rap",      "☁",  60, 150,  ["cloud rap", "cloudrap"]),
    ("UK rap",         "🎤", 85, 145,  ["uk rap", "road rap", "ukrap"]),
    ("Neo soul",       "🕯",  60, 100, ["neo soul", "neosoul", "neo-soul"]),
    ("Soul",           "🕯",  60, 120, ["soul", "motown"]),
    ("Jersey club",    "🛞", 130, 145, ["jersey club", "jersey", "bed squeak"]),
    ("Bass house",     "🔊", 124, 130, ["bass house", "basshouse"]),
    ("Progressive house", "🌄", 122, 130, ["progressive house", "prog house"]),
    ("Acid house",     "🧪", 118, 130, ["acid house", "303"]),
    ("French house",   "🥖", 115, 128, ["french house", "filter house", "french touch"]),
    ("Future house",   "🔮", 120, 128, ["future house"]),
    ("Nu disco",       "🪩",  110, 125, ["nu disco", "nu-disco", "nudisco"]),
    ("Minimal techno", "⚙",  122, 132, ["minimal techno", "minimal", "microhouse"]),
    ("Electro",        "🤖", 120, 135, ["electro", "electro funk"]),
    ("Riddim",         "🛸", 140, 150, ["riddim", "riddim dubstep"]),
    ("Footwork",       "👟", 155, 165, ["footwork", "juke"]),
    ("Indie pop",      "🎸", 90, 140,  ["indie pop", "bedroom pop", "dream pop"]),
    ("Synth-pop",      "🎹", 100, 130, ["synth-pop", "synthpop", "synth pop"]),
    ("K-pop",          "🎀", 90, 140,  ["k-pop", "kpop", "k pop"]),
    ("EDM",            "🎆", 124, 132, ["edm", "festival edm"]),
    ("Big room",       "🏟", 126, 130, ["big room", "bigroom"]),
    ("Chillwave",      "🌅", 70, 110,  ["chillwave", "vaporwave"]),
    ("Trip hop",       "🌫", 70, 100,  ["trip hop", "triphop", "trip-hop"]),
    ("IDM",            "🧠", 1, 200,   ["idm", "braindance", "intelligent dance"]),
    ("Experimental",   "🧪", 1, 200,   ["experimental", "abstract", "noise music", "avant garde"]),
    ("Glitch",         "📟", 1, 200,   ["glitch", "glitch hop"]),
    ("Industrial",     "🏭", 100, 150, ["industrial", "ebm"]),
    ("Chiptune",       "👾", 1, 200,   ["chiptune", "8bit", "8-bit"]),
    ("Metal",          "🤘", 80, 220,  ["metal", "heavy metal", "djent", "metalcore"]),
    ("Punk",           "🤘", 140, 220, ["punk", "pop punk", "hardcore punk"]),
    ("Emo",            "🖤", 80, 180,  ["emo", "midwest emo"]),
    ("Shoegaze",       "🌫", 70, 140,  ["shoegaze"]),
    ("Funk",           "🕺", 90, 125,  ["funk", "funky"]),
    ("Blues",          "🎸", 60, 140,  ["blues"]),
    ("Gospel",         "🙏", 60, 140,  ["gospel", "worship"]),
    ("Folk",           "🪕", 60, 140,  ["folk", "folk song"]),
    ("Country",        "🤠", 70, 140,  ["country", "americana"]),
    ("Classical",      "🎻", 1, 200,   ["classical", "string quartet", "sonata", "symphony"]),
    ("Reggae",         "🌴", 60, 90,   ["reggae", "roots reggae", "ska"]),
    ("Dub",            "🔉", 60, 90,   ["dub", "dub reggae"]),
    ("Moombahton",     "🔊", 105, 112, ["moombahton", "moombah"]),
    ("Baile funk",     "🇧🇷", 125, 135, ["baile funk", "funk carioca", "brazilian funk", "funk brasileiro"]),
    ("Latin",          "💃", 80, 200,  ["latin", "salsa", "cumbia", "bachata", "bossa nova", "samba"]),
    ("Game music",     "🎮", 1, 200,   ["game music", "video game", "level theme", "boss theme"]),
]
_TEMPO_ALONE = {g for g, *_ in _GENRES}
_GENRES = _GENRES + _NAMED_ONLY

def _hits(text: str) -> set[str]:
    """The genre keywords found in text. A keyword inside a longer one that also
    matched there doesn't count, so "deep house" is Deep house and not House too."""
    spans = []
    for _g, _e, _lo, _hi, kws in _GENRES:
        for kw in kws:
            for m in re.finditer(r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])", text):
                spans.append((m.start(), m.end(), kw))
    return {kw for a, b, kw in spans
            if not any(a2 <= a and b <= b2 and (b2 - a2) > (b - a) for a2, b2, _k in spans)}


# When only the tempo speaks, lean a little towards the genres most producers make,
# so a 145 BPM beat reads as Trap before Hardstyle.
_COMMON = {"Trap", "House", "Hip hop", "DnB", "Techno", "Pop", "Lo-fi"}

_NEUTRAL = {"genre": None, "emoji": "🎵", "confidence": 0.0, "alternatives": []}
_EMOJI = {g: e for g, e, *_ in _GENRES}


def _learned_points(genre: str, bpm_r, learned) -> float:
    if bpm_r is None or not learned:
        return 0.0
    near = sum(1 for b, g in learned if g == genre and b is not None and abs(b - bpm_r) <= _LEARN_BPM)
    return _LEARN_POINTS * min(near, 3)


def known_genres() -> list[str]:
    return [g for g, *_ in _GENRES]


def emoji_for(genre: str | None) -> str:
    return _EMOJI.get(genre, "🎵")


# How near (in BPM) a project you corrected has to be to count as "similar", and how
# much each one adds. A name keyword (6) still beats a couple of corrections.
_LEARN_BPM = 4
_LEARN_POINTS = 3.0


def guess_genre(name: str, bpm: float | None, sample_names=(), learned=()) -> dict:
    """Return {genre, emoji, bpm, confidence, alternatives}. genre is None when there
    isn't enough signal. Confidence reflects EVIDENCE QUALITY: a genre word in the
    project name is near-certain (the producer said so); a sample-name word is
    medium; a bare BPM band is a low-confidence guess (tempos overlap).

    `learned` is [(bpm, genre)] from projects the producer corrected: similar tempos
    lean towards the genre they picked (their own genres included)."""
    name_l = (name or "").lower()
    samp_l = " ".join(sample_names).lower()
    bpm_r = round(bpm) if bpm else None

    name_hits = _hits(name_l)
    samp_hits = _hits(samp_l)

    scored = []  # (score, has_name_kw, has_sample_kw, genre, emoji)
    for genre, emoji, lo, hi, kws in _GENRES:
        s = 0.0
        name_kw = samp_kw = False
        for kw in kws:
            if kw in name_hits:
                s += 6.0
                name_kw = True
            if kw in samp_hits:
                s += 1.5
                samp_kw = True
        s += _learned_points(genre, bpm_r, learned)
        if bpm_r is not None and (genre in _TEMPO_ALONE or s > 0):
            if lo <= bpm_r <= hi:
                # in range; nearer the middle of the range scores a little more, so
                # overlapping ranges are settled by the closest fit, not list order
                s += 2.0 + 0.5 * max(0.0, 1 - abs(bpm_r - (lo + hi) / 2) / 10)
                s += 0.3 if genre in _COMMON else 0.0
            elif lo - 5 <= bpm_r <= hi + 5:
                s += 0.7
        if s > 0:
            scored.append((s, name_kw, samp_kw, genre, emoji))
    # genres the producer made up themselves can be guessed too, from their corrections
    for genre in sorted({g for _b, g in learned if g and g not in _EMOJI}):
        name_kw = _has_kw(genre.lower(), name_l)
        s = _learned_points(genre, bpm_r, learned) + (6.0 if name_kw else 0.0)
        if s > 0:
            scored.append((s, name_kw, False, genre, "🎵"))

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
