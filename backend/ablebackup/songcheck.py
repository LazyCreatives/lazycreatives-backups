"""Will this song play anywhere? A quick look at an album song's file: its format, bit
depth, sample rate and bitrate, and whether it clips or is very quiet. Measured with
the ffmpeg that ships inside the app, which only reads the file. Nothing is ever
written next to the song, and the song itself is never changed, copied or converted.

SHARED FILE: the same file lives in Backups (backend/ablebackup/songcheck.py) and
Uploader (backend/lazyupload/songcheck.py). Keep the two byte-identical.

`measure` reads the file (slow: it plays the whole song through ffmpeg at high speed),
`judge` turns what was measured into plain words (quick, so the rules can change
without measuring every song again).
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .playback import ffmpeg

MEASURE_VERSION = 1   # bump when `measure` returns something new, so old results are redone
TIMEOUT = 600         # seconds one song may take (a two-hour mix still fits)

# What every CDJ and USB player since the CDJ-2000 plays.
SAFE_RATES = {44100, 48000}
QUIET_LUFS = -18.0    # club masters sit around -10 to -6 LUFS
TRUE_PEAK_MAX = 1.0   # dBTP: over this it can distort on DJ gear and in SoundCloud's MP3


class CannotCheck(Exception):
    """The file couldn't be read."""


def measure(path: str) -> dict:
    """Read the whole song once and note its format and levels."""
    exe = ffmpeg()
    if not exe:
        raise CannotCheck("ffmpeg is missing")
    cmd = [exe, "-hide_banner", "-nostdin", "-i", str(path), "-map", "0:a:0",
           "-af", "astats=metadata=0:measure_perchannel=none,ebur128=peak=true:framelog=verbose",
           "-c:a", "pcm_f32le", "-f", "null", "-"]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired) as e:
        raise CannotCheck(str(e)) from None
    out = r.stderr.decode("utf-8", "replace")
    info = parse(out)
    if r.returncode != 0 or not info.get("codec"):
        raise CannotCheck("not an audio file ffmpeg can read")
    info["ext"] = Path(path).suffix.lower()
    info["v"] = MEASURE_VERSION
    return info


_STREAM = re.compile(r"Stream #0:\d+.*?: Audio: (\w+)[^,]*, (\d+) Hz, ([^,]+), ([^,\n]+)(?:, (\d+) kb/s)?")
_DURATION = re.compile(r"Duration: (\d+):(\d+):([\d.]+).*?bitrate: (\d+) kb/s")
_BITS = re.compile(r"\((\d+) bit\)")
_CHANNELS = {"mono": 1, "stereo": 2, "2.1": 3, "quad": 4, "5.0": 5, "5.1": 6, "6.1": 7, "7.1": 8}


def _num(text: str, label: str) -> float | None:
    m = re.search(rf"{label}:\s*(-?[\d.]+|-?inf)", text)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def parse(out: str) -> dict:
    """What ffmpeg said about the file (its first audio stream) and its levels."""
    head = out.split("Stream mapping:")[0]
    info: dict = {}
    m = _STREAM.search(head)
    if m:
        codec, rate, layout, fmt, kbps = m.groups()
        info["codec"] = codec
        info["rate"] = int(rate)
        layout = layout.strip()
        info["channels"] = _CHANNELS.get(layout.split("(")[0].strip()) or (
            int(layout.split()[0]) if layout.split()[0].isdigit() else 2)
        fmt = fmt.strip()
        pcm = re.match(r"pcm_([suf])(\d+)", codec)
        if pcm:   # the codec says it: pcm_s24le is 24-bit, pcm_f32le is 32-bit float
            info["float"], info["bits"] = pcm.group(1) == "f", int(pcm.group(2))
        else:     # lossless: "s32 (24 bit)" or "s16p"; lossy formats have no bit depth
            b = _BITS.search(fmt) or (re.match(r"[su](\d+)", fmt) if codec in ("flac", "alac") else None)
            info["float"], info["bits"] = False, int(b.group(1)) if b else None
        info["kbps"] = int(kbps) if kbps else None
    d = _DURATION.search(head)
    if d:
        h, mnt, s, total_kbps = d.groups()
        info["seconds"] = int(h) * 3600 + int(mnt) * 60 + float(s)
        if info.get("codec") == "mp3":   # the file's average: right for VBR too
            info["kbps"] = int(total_kbps)
    tail = out.split("Overall")[-1] if "Overall" in out else ""
    info["peak_db"] = _num(tail, "Peak level dB")
    info["flat"] = _num(tail, "Flat factor")
    summary = out.split("Summary:")[-1] if "Summary:" in out else ""
    info["lufs"] = _num(summary, r"\bI")
    info["true_peak_db"] = _num(summary.split("True peak:")[-1], "Peak") if "True peak:" in summary else None
    return info


# ── what it means ──────────────────────────────────────────────────────────────

_NAMES = {"mp3": "MP3", "flac": "FLAC", "aac": "AAC", "alac": "Apple Lossless", "vorbis": "Ogg",
          "opus": "Opus", "wmav2": "WMA", "wmav1": "WMA", "wmapro": "WMA"}
_LOSSLESS_EXT = {".wav": "WAV", ".wave": "WAV", ".aif": "AIFF", ".aiff": "AIFF", ".aifc": "AIFF"}


def format_name(info: dict) -> str:
    codec = info.get("codec") or ""
    if codec.startswith("pcm_"):
        return _LOSSLESS_EXT.get(info.get("ext") or "", "WAV")
    return _NAMES.get(codec, codec.upper() or "Unknown")


def summary(info: dict) -> str:
    """"WAV · 24-bit · 44.1 kHz" or "MP3 · 320 kbps · 44.1 kHz"."""
    parts = [format_name(info)]
    codec = info.get("codec") or ""
    if codec in ("mp3", "aac", "vorbis", "opus") or codec.startswith("wma"):
        if info.get("kbps"):
            parts.append(f"{info['kbps']} kbps")
    elif info.get("bits"):
        parts.append(f"{info['bits']}-bit{' float' if info.get('float') else ''}")
    if info.get("rate"):
        k = info["rate"] / 1000
        parts.append(f"{k:g} kHz")
    if (info.get("channels") or 2) != 2:
        parts.append("mono" if info["channels"] == 1 else f"{info['channels']} channels")
    return " · ".join(parts)


def judge(info: dict) -> list[dict]:
    """Plain-English problems for playing this song on DJ gear (CDJs, USB sticks, club
    systems), each with what to do about it. An empty list: it plays anywhere."""
    out: list[dict] = []

    def add(short: str, what: str, fix: str):
        out.append({"short": short, "what": what, "fix": fix})

    codec = info.get("codec") or ""
    name = format_name(info)
    wav_like = codec.startswith("pcm_")
    if codec == "mp3":
        kbps = info.get("kbps") or 0
        if kbps and kbps < 256:
            add(f"MP3 {kbps}", f"MP3 at {kbps} kbps. DJs and club systems expect 320.", "Export it as a WAV, or as an MP3 at 320 kbps.")
    elif codec == "flac":
        add("FLAC", "FLAC. Older CDJs (before the CDJ-2000NXS2) can't play it.", "Export a WAV or AIFF for DJs.")
    elif codec == "aac":
        add("AAC", "AAC (M4A). Some DJ players and USB sticks won't play it.", "Export a WAV or AIFF for DJs.")
    elif not wav_like:
        add(name, f"{name}. CDJs can't play it.", "Export a WAV or AIFF for DJs.")
    elif info.get("ext") in (".wav", ".wave") and not re.match(r"pcm_[suf]\d+(le|be)?$", codec):
        add("Compressed WAV", "A compressed WAV. CDJs can't play it.", "Export a plain WAV.")

    bits = info.get("bits")
    if wav_like or codec in ("flac", "alac"):
        if info.get("float") or (bits and bits >= 32):
            depth = f"{bits or 32}-bit{' float' if info.get('float') else ''}"
            add(depth, f"{depth}. Most CDJs can't play it.",
                "Export it at 24-bit.")
        elif bits and bits < 16:
            add(f"{bits}-bit", f"{bits}-bit. Lower quality than a CD.", "Export it at 16 or 24-bit.")

    rate = info.get("rate")
    if rate and rate not in SAFE_RATES:
        k = f"{rate / 1000:g} kHz"
        if rate < 44100:
            add(k, f"{k}. Lower quality than a CD.", "Export it at 44.1 kHz.")
        elif rate <= 96000:
            add(k, f"{k}. Older CDJs only play 44.1 or 48 kHz.", "Export it at 44.1 kHz.")
        else:
            add(k, f"{k}. Most CDJs can't play it.", "Export it at 44.1 kHz.")

    if (info.get("channels") or 2) > 2:
        add(f"{info['channels']} channels", f"{info['channels']} channels. DJ gear plays stereo only.", "Export it in stereo.")

    peak, flat, tp = info.get("peak_db"), info.get("flat"), info.get("true_peak_db")
    if peak is not None and peak > 0.05:
        add("Over 0 dB", f"Goes {peak:.1f} dB over full level, so it will distort.", "Turn the master down, or put a limiter last with its ceiling at -0.3 dB.")
    elif peak is not None and peak >= -0.05 and (flat or 0) >= 2:
        add("Clips", "Clips: it hits full level and stays there.", "Turn the master down, or put a limiter last with its ceiling at -0.3 dB.")
    elif tp is not None and tp > TRUE_PEAK_MAX:
        add(f"Peaks +{tp:.1f} dB", f"Peaks at +{tp:.1f} dB between samples. It may distort on DJ gear and on SoundCloud.",
            "Set your limiter's ceiling to -0.3 dB, or turn on its true-peak mode.")

    lufs = info.get("lufs")
    if lufs is not None and lufs > -70 and lufs < QUIET_LUFS:
        add("Quiet", f"Quiet: {lufs:.0f} LUFS. Club tracks are usually -10 to -6, so DJs will need to turn it right up.",
            "Master it louder.")
    return out
