"""Stem sets and stem packs.

A project's stems are grouped into sets: the parts exported together (same folder,
saved within a few minutes of each other). Each set is checked from the file
headers only (do the parts have the same length and quality, so they line up in
another program?) and can be packed into one zip with the matching master, an
instrumental when there is one, and a sheet with the BPM and key, ready to send to
a label, a mix engineer or a remix contest.

Your files are only read. A pack is a NEW zip written to the folder you pick.
"""
from __future__ import annotations

import hashlib
import os
import re
import struct
import time
import uuid
import zipfile
from pathlib import Path

from ablebackup import audiolen
from ablebackup.audiolen import _ext80
from ablebackup.stems import _ABLETON_PART, _SPLIT, words

# Stems saved further apart than this, or in another folder, belong to another set.
SET_GAP = 15 * 60
# Parts whose lengths differ by more than this probably won't line up.
LENGTH_SLACK = 0.05
# The groups a stem set is sorted into and the words in a part's name that put it
# there. The first group (in this order) with a word in the name wins, so "Vocal FX"
# is a vocal and "Synth Bass" is bass. The desk shows them in GROUP_IDS order.
GROUPS = [
    ("vocals", "Vocals", {"vox", "vocal", "vocals", "voc", "vocs", "acapella", "acappella", "adlib",
                          "adlibs", "choir", "hook", "harmony", "harmonies", "bv", "bvs", "rap", "verse",
                          "spoken", "talk", "dbl", "double", "ooh", "aah", "singer"}),
    ("drums", "Drums", {"kick", "kicks", "kik", "bd", "snare", "snares", "snr", "clap", "claps", "hat",
                        "hats", "hihat", "hihats", "hh", "oh", "perc", "percs", "percussion", "drum",
                        "drums", "shaker", "shakers", "ride", "crash", "cymbal", "cymbals", "tom", "toms",
                        "top", "tops", "rim", "rimshot", "tamb", "tambourine", "conga", "bongo", "break",
                        "breaks", "groove", "beat", "808kick", "snap", "snaps", "cowbell", "overheads"}),
    ("bass", "Bass", {"bass", "sub", "subs", "808", "808s", "reese", "bassline"}),
    ("music", "Keys and synths", {"synth", "synths", "lead", "leads", "pad", "pads", "keys", "key",
                                  "piano", "rhodes", "organ", "chord", "chords", "arp", "arps", "pluck",
                                  "plucks", "guitar", "guitars", "gtr", "strings", "string", "brass",
                                  "horns", "horn", "bells", "bell", "flute", "sax", "melody", "mel",
                                  "stab", "stabs", "violin", "cello", "harp", "marimba", "mallet",
                                  "wurli", "epiano", "ep", "seq", "sequence"}),
    ("fx", "FX", {"fx", "sfx", "riser", "risers", "impact", "impacts", "atmos", "atmosphere", "ambience",
                  "ambient", "texture", "textures", "sweep", "sweeps", "uplifter", "downlifter",
                  "noise", "reverse", "whoosh", "transition", "foley", "fill", "fills", "drop",
                  "vinyl", "crackle", "rev", "verb", "reverb", "delay", "return"}),
]
GROUP_IDS = ["drums", "bass", "vocals", "music", "fx", "other"]
GROUP_NAMES = {g[0]: g[1] for g in GROUPS} | {"other": "Other"}


def auto_group(part: str, file_name: str = "") -> str:
    """Which group a stem goes in, from the words in its part name (then its file name)."""
    for text in (part, Path(file_name).stem):
        ws = {w.lower() for w in re.findall(r"[A-Za-z]+|\d+[A-Za-z]*", text)}
        for gid, _, keys in GROUPS:
            if ws & keys:
                return gid
    return "other"


_INSTRUMENTAL = re.compile(r"\binst(rumental)?\b|\bno[\s_-]?vox\b|\bno[\s_-]?vocals?\b", re.I)


def audio_info(path: str) -> dict:
    """Length, sample rate, bit depth and channels from the header (WAV, AIFF);
    other formats give their length only. Nothing is decoded."""
    info = {"seconds": audiolen.seconds(path), "rate": None, "bits": None, "channels": None}
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            if head[:4] in (b"RIFF", b"RF64") and head[8:12] == b"WAVE":
                while True:
                    ch = f.read(8)
                    if len(ch) < 8:
                        break
                    cid, n = ch[:4], struct.unpack("<I", ch[4:])[0]
                    if cid == b"fmt ":
                        body = f.read(16)
                        info["channels"], info["rate"] = struct.unpack("<HI", body[2:8])
                        info["bits"] = struct.unpack("<H", body[14:16])[0]
                        break
                    f.seek(n + (n & 1), 1)
            elif head[:4] == b"FORM" and head[8:12] in (b"AIFF", b"AIFC"):
                while True:
                    ch = f.read(8)
                    if len(ch) < 8:
                        break
                    cid, n = ch[:4], struct.unpack(">I", ch[4:])[0]
                    if cid == b"COMM":
                        body = f.read(18)
                        info["channels"] = struct.unpack(">H", body[0:2])[0]
                        info["bits"] = struct.unpack(">H", body[6:8])[0]
                        info["rate"] = round(_ext80(body[8:18]))
                        break
                    f.seek(n + (n & 1), 1)
    except (OSError, struct.error, ValueError):
        pass
    return info


_NUMBERED_PART = re.compile(r"\s\d{1,3}-(\d\S*)")


def part_name(file_name: str, project: str) -> str:
    """The part a stem holds, in short: "Song 3-Kick.wav" -> "Kick",
    "Night Drive - Vocals.wav" -> "Vocals". Falls back to the file's own name."""
    name = Path(file_name).stem
    # Ableton's "Song 3-Kick"; also "Song 37-808" (a part that starts with a number)
    m = _ABLETON_PART.search(name) or _NUMBERED_PART.search(name)
    if m:
        return name[m.start(1):].strip() or name
    pieces = _SPLIT.split(name)
    if len(pieces) > 1:
        return pieces[-1].strip(" )]_-") or name
    ws = name.replace("_", " ").split()
    proj = set(words(project))
    rest = [w for w in ws if w.lower() not in proj]
    return " ".join(rest) if rest and len(rest) < len(ws) else name


def _natural(name: str) -> list:
    """Sort key that puts "Song 2-Kick" before "Song 10-Snare"."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _set_id(paths: list[str]) -> str:
    return hashlib.sha1("\n".join(sorted(paths)).encode()).hexdigest()[:12]


def _fmt_len(s: float) -> str:
    return f"{int(s // 60)}:{int(s % 60):02d}"


def check_set(parts: list[dict]) -> dict:
    """Do the parts line up? Plain-words problems, empty when they do."""
    problems: list[str] = []
    lengths = [p["seconds"] for p in parts if p.get("seconds") is not None]
    if len(lengths) > 1 and max(lengths) - min(lengths) > LENGTH_SLACK:
        problems.append(f"The parts aren't the same length ({_fmt_len(min(lengths))} to "
                        f"{_fmt_len(max(lengths))}), so they may not line up.")
    rates = sorted({p["rate"] for p in parts if p.get("rate")})
    if len(rates) > 1:
        problems.append("The parts have different sample rates ("
                        + " and ".join(f"{r / 1000:g} kHz" for r in rates) + ").")
    bits = sorted({p["bits"] for p in parts if p.get("bits")})
    if len(bits) > 1:
        problems.append("The parts have different bit depths ("
                        + " and ".join(f"{b}-bit" for b in bits) + ").")
    unknown = sum(1 for p in parts if p.get("seconds") is None)
    return {"ok": not problems, "problems": problems,
            "unread": unknown,  # lengths that couldn't be read (MP3s without a header, M4A)
            "seconds": max(lengths) if lengths else None,
            "rate": rates[0] if len(rates) == 1 else None,
            "bits": bits[0] if len(bits) == 1 else None}


def _nearest(rows: list[dict], when: float) -> dict | None:
    return min(rows, key=lambda r: abs((r.get("mtime") or 0) - when), default=None)


def stem_sets(rows: list[dict], project: str, moved: dict | None = None) -> list[dict]:
    """Group a project's export rows into stem sets, newest first, each with its
    parts, line-up check and the song and instrumental that go with it. Each part
    is sorted into a group (Drums, Bass…); ``moved`` holds the stems you dragged to
    another group (path -> group) and wins over the automatic one."""
    moved = moved or {}
    stems = sorted((r for r in rows if r.get("kind") == "stem" and os.path.isfile(r["path"])),
                   key=lambda r: (str(Path(r["path"]).parent), r.get("mtime") or 0))
    songs = [r for r in rows if r.get("kind") != "stem" and os.path.isfile(r["path"])]
    instrumentals = [r for r in songs if _INSTRUMENTAL.search(Path(r["path"]).stem)]
    mains = [r for r in songs if r not in instrumentals]
    groups: list[list[dict]] = []
    for r in stems:
        cur = groups[-1] if groups else None
        if cur and Path(cur[-1]["path"]).parent == Path(r["path"]).parent \
                and (r.get("mtime") or 0) - (cur[-1].get("mtime") or 0) <= SET_GAP:
            cur.append(r)
        else:
            groups.append([r])
    out = []
    for g in groups:
        when = max(r.get("mtime") or 0 for r in g)
        parts = []
        for r in sorted(g, key=lambda r: _natural(r["name"])):
            part = part_name(r["name"], project)
            auto = auto_group(part, r["name"])
            group = moved.get(r["path"]) if moved.get(r["path"]) in GROUP_IDS else auto
            parts.append({"path": r["path"], "name": r["name"], "part": part,
                          "group": group, "auto_group": auto,
                          "size": r.get("size"), **audio_info(r["path"])})
        parts.sort(key=lambda p: GROUP_IDS.index(p["group"]))  # stable: 2 before 10, as exported
        master = _nearest(mains, when)
        inst = _nearest(instrumentals, when)
        out.append({
            "id": _set_id([p["path"] for p in parts]),
            "when": when,
            "folder": str(Path(g[0]["path"]).parent),
            "parts": parts,
            "size": sum(p["size"] or 0 for p in parts),
            "check": check_set(parts),
            "master": {"path": master["path"], "name": master["name"]} if master else None,
            "instrumental": {"path": inst["path"], "name": inst["name"]} if inst else None,
        })
    out.sort(key=lambda s: s["when"], reverse=True)
    return out


def _safe(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', " ", name).strip() or "Song"


def song_sheet(project: dict, s: dict) -> str:
    """The "About this song.txt" that goes in the pack."""
    c = s["check"]
    lines = [project.get("name") or "Song", ""]
    lines.append("Exported: " + time.strftime("%d %B %Y", time.localtime(s["when"])))
    if project.get("bpm"):
        lines.append(f"BPM: {project['bpm']:g}")
    if project.get("music_key"):
        lines.append(f"Key: {project['music_key']}")
    if project.get("genre"):
        lines.append(f"Genre: {project['genre']}")
    if c.get("seconds"):
        lines.append(f"Length: {_fmt_len(c['seconds'])}")
    if c.get("rate") or c.get("bits"):
        q = [f"{c['rate'] / 1000:g} kHz" if c.get("rate") else "", f"{c['bits']}-bit" if c.get("bits") else ""]
        lines.append("Quality: " + ", ".join(x for x in q if x))
    lines += ["", "Every part is the same length: line them all up at the start."
              if c["ok"] else "Check before use: " + " ".join(c["problems"]), ""]
    if s.get("master"):
        lines.append(f"Full song: {Path(s['master']['path']).name}")
    if s.get("instrumental"):
        lines.append(f"Instrumental: {Path(s['instrumental']['path']).name}")
    lines.append(f"Stems ({len(s['parts'])}), in folders by group:")
    for gid in GROUP_IDS:
        mine = [p for p in s["parts"] if (p.get("group") or "other") == gid]
        if mine:
            lines.append(f"  {GROUP_NAMES[gid]} ({len(mine)})")
            lines += [f"    {p['part']}  ({Path(p['path']).name})" for p in mine]
    lines += ["", "Packed by Lazy Creatives Backups."]
    return "\n".join(lines) + "\n"


def make_pack(project: dict, s: dict, target_dir: str) -> str:
    """Write one stem set, its song, instrumental and sheet into a NEW zip in
    target_dir and return its path. The originals are only read. The zip appears
    only when finished, so a half-written pack is never left behind."""
    day = time.strftime("%Y-%m-%d", time.localtime(s["when"]))
    base = f"{_safe(project.get('name') or 'Song')} stems ({day})"
    zip_path = Path(target_dir) / f"{base}.zip"
    n = 1
    while zip_path.exists():
        zip_path = Path(target_dir) / f"{base} ({n}).zip"
        n += 1
    tmp = zip_path.with_name(f".{zip_path.name}.{uuid.uuid4().hex}.tmp")
    used: set[str] = set()

    def arc(name: str) -> str:
        a, i = name, 1
        while a.lower() in used:
            p = Path(name)
            a = f"{p.parent.as_posix()}/{p.stem} ({i}){p.suffix}"
            i += 1
        used.add(a.lower())
        return a

    try:
        # Audio barely shrinks, so store it as is: quick, and opens anywhere.
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
            z.writestr(arc(f"{base}/About this song.txt"), song_sheet(project, s))
            for key in ("master", "instrumental"):
                if s.get(key) and os.path.isfile(s[key]["path"]):
                    z.write(s[key]["path"], arc(f"{base}/{Path(s[key]['path']).name}"))
            for p in s["parts"]:
                if os.path.isfile(p["path"]):
                    folder = GROUP_NAMES.get(p.get("group") or "other", "Other")
                    z.write(p["path"], arc(f"{base}/Stems/{folder}/{Path(p['path']).name}"))
        os.replace(tmp, zip_path)
    finally:
        tmp.unlink(missing_ok=True)
    return str(zip_path)
