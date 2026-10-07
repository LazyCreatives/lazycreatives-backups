#!/usr/bin/env python3
"""Build a realistic fake music library on disk for the Backups picture tests.

Usage:  python seed_library.py <workdir>     (run for you by e2e/global-setup.ts)

Creates <workdir>/home (a fake $HOME) holding:
  Music/Ableton/Projects/<Name> Project/<Name>.als   (gzipped Live sets, tempo, tracks, plugins)
  Music/REAPER Projects/<Name>/<Name>.rpp
  Music/FL Studio/Projects/<Name>/<Name>.flp
  Music/Splice/...                                    (shared sample library, absolute refs)
  plus exported songs (<Name> v3.wav etc., real audio so waveforms draw) next to
  about half of the projects, a few projects with missing samples, and file times
  spread over the last ~10 months. Also some installed plug-ins (.vst3, .clap, .vst,
  .lv2 and "Mac Plugins/Components") for the Plugins page.
Stdlib only; deterministic (seeded RNG).
"""
import gzip
import math
import os
import plistlib
import random
import struct
import sys
import time
import wave
from array import array
from pathlib import Path
from xml.sax.saxutils import quoteattr

RNG = random.Random(20261005)
NOW = time.time()
DAY = 86400

# name, daw, bpm, exported?, missing-samples?, days since last save
PROJECTS = [
    ("Midnight Drive", "als", 124, True, False, 2),
    ("Dusty Tape Loop", "als", 78, True, False, 5),
    ("Warehouse Ritual", "als", 132, True, False, 9),
    ("Amen Breakdown", "als", 174, True, True, 14),
    ("Neon Rain", "als", 140, False, False, 1),
    ("Glass Pavilion", "rpp", 86, True, False, 21),
    ("Soft Focus", "als", 72, False, False, 33),
    ("Velvet Static", "als", 122, True, False, 40),
    ("Cold Brew Sunday", "als", 84, False, False, 3),
    ("Drift Phonk 808", "flp", 145, True, False, 12),
    ("Riverside Garage", "als", 132, True, False, 60),
    ("Lighthouse", "rpp", 96, False, True, 75),
    ("Paper Planes Topline", "als", 118, True, False, 18),
    ("Supersaw Sunrise", "als", 138, False, False, 90),
    ("Basement Tapes 04", "flp", 90, False, False, 110),
    ("Afterglow", "als", 126, True, False, 7),
    ("Liquid Hours", "als", 172, True, False, 26),
    ("South London Drill", "flp", 142, False, True, 48),
    ("Field Recording Dawn", "rpp", 60, False, False, 140),
    ("Chrome Hearts", "als", 128, True, False, 30),
    ("Late Checkout", "als", 120, False, False, 55),
    ("Hyperpop Heartbreak", "als", 160, True, False, 16),
    ("Grime Bars 140", "flp", 140, False, False, 170),
    ("Moss & Concrete", "als", 75, False, False, 200),
    ("Acid Test 303", "als", 130, True, False, 11),
    ("Golden Hour Jazz", "als", 88, True, False, 65),
    ("Wobble Science", "als", 140, False, False, 230),
    ("Rooftop Sessions", "rpp", 100, False, False, 38),
    ("Night Market", "als", 123, False, False, 4),
    ("Blue Lines Remix", "als", 93, True, False, 85),
    ("Kick Lead Anthem", "flp", 150, False, False, 260),
    ("Tidal Pads", "als", 64, False, False, 300),
    ("Untitled Beat 17", "als", 92, False, False, 6),
    ("Cassette Daydream", "rpp", 82, True, False, 120),
]

PLUGINS = ["Serum", "Vital", "FabFilter Pro-Q 3", "Valhalla VintageVerb", "Soundtoys Decapitator",
           "OTT", "Kontakt 7", "Omnisphere", "RC-20 Retro Color", "Pigments", "Diva",
           "Ozone 11 Maximizer", "LFOTool", "Trackspacer", "Massive X"]
SAMPLE_WORDS = {
    "drums": ["Kick", "Snare", "Clap", "HiHat Closed", "Open Hat", "Rim", "Perc Loop", "Shaker"],
    "music": ["Rhodes Chord", "Pad Swell", "Vox Chop", "Bass One Shot", "Guitar Lick", "Piano Loop",
              "String Stab", "Synth Arp", "Vinyl Crackle", "Riser FX"],
}
SPLICE_PACKS = ["Splice/Sounds/packs/Late Night Lo-fi", "Splice/Sounds/packs/Deep House Essentials",
                "Splice/Sounds/packs/Drum & Bass Foundations", "Splice/Sounds/packs/Trap Kingdom",
                "Splice/Sounds/packs/Techno Tools Vol 2"]


def wav_bytes_silence(path: Path, seconds: float, rate: int = 22050) -> None:
    """A real (quiet noise) mono WAV for samples. Small, valid, cheap to write."""
    n = int(seconds * rate)
    data = array("h", (RNG.randint(-300, 300) for _ in range(min(n, 4000))))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data.tobytes())
        # pad with zero frames to the requested length without building a big list
        rest = n - len(data)
        if rest > 0:
            w.writeframes(b"\x00\x00" * rest)


def wav_song(path: Path, bpm: float, seconds: float = 48.0, rate: int = 8000) -> None:
    """A short 'song' with sections (intro / drop / break / drop / outro) so the
    waveform outline looks like real music rather than a flat block."""
    n = int(seconds * rate)
    beat = 60.0 / bpm
    sections = [(0.0, 0.12, 0.35), (0.12, 0.45, 0.95), (0.45, 0.58, 0.4), (0.58, 0.9, 1.0), (0.9, 1.0, 0.25)]
    out = array("h")
    f1 = RNG.choice([55.0, 61.7, 65.4, 73.4])
    for i in range(n):
        t = i / rate
        pos = i / n
        amp = 0.3
        for lo, hi, a in sections:
            if lo <= pos < hi:
                amp = a
                break
        ph = (t % beat) / beat
        kick = math.exp(-ph * 9) * math.sin(2 * math.pi * f1 * 2 * t) if amp > 0.5 else 0.0
        pad = 0.35 * math.sin(2 * math.pi * f1 * 4 * t) * (0.6 + 0.4 * math.sin(2 * math.pi * t / (beat * 8)))
        noise = (RNG.random() - 0.5) * 0.25 * amp
        v = amp * (0.55 * kick + pad) + noise
        out.append(int(max(-1.0, min(1.0, v)) * 26000))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(out.tobytes())


def als_xml(bpm: float, tracks: int, plugins: list[str], refs: list[tuple[str, str]]) -> str:
    """refs: (kind, value) where kind is 'rel' (RelativePath) or 'abs' (Path)."""
    track_xml = []
    per = max(1, math.ceil(len(refs) / tracks))
    for t in range(tracks):
        tag = "AudioTrack" if t % 2 == 0 else "MidiTrack"
        chunk = refs[t * per:(t + 1) * per]
        srefs = "".join(
            "<SampleRef><FileRef>"
            + (f'<RelativePath Value={quoteattr(v)}/>' if k == "rel" else f'<Path Value={quoteattr(v)}/>')
            + f'<Name Value={quoteattr(os.path.basename(v))}/>'
            + "</FileRef></SampleRef>"
            for k, v in chunk)
        plug = ""
        if t < len(plugins):
            plug = (f'<PluginDevice><PluginDesc><Vst3PluginInfo><Name Value={quoteattr(plugins[t])}/>'
                    "</Vst3PluginInfo></PluginDesc></PluginDevice>")
        track_xml.append(f"<{tag}><DeviceChain>{srefs}{plug}</DeviceChain></{tag}>")
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            '<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.1">'
            "<LiveSet><Tracks>" + "".join(track_xml) + "</Tracks>"
            f'<MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="{bpm}"/></Tempo></Mixer></DeviceChain></MasterTrack>'
            "</LiveSet></Ableton>")


def rpp_text(bpm: float, plugins: list[str], files: list[str]) -> str:
    lines = ['<REAPER_PROJECT 0.1 "7.22/macOS-arm64" 1727000000', f"  TEMPO {bpm} 4 4"]
    for i, f in enumerate(files):
        lines.append("  <TRACK")
        if i < len(plugins):
            lines.append(f'    <FXCHAIN\n      <VST "VST3: {plugins[i]}" plugin.vst3 0 "" 0\n      >\n    >')
        lines += ["    <ITEM", "      <SOURCE WAVE", f'        FILE "{f}"', "      >", "    >", "  >"]
    lines.append('  RENDER_FILE "renders/mixdown.wav"')
    lines.append(">")
    return "\n".join(lines) + "\n"


def flp_bytes(bpm: float, plugins: list[str], paths: list[str]) -> bytes:
    def text_event(eid: int, s: str) -> bytes:
        payload = s.encode("utf-16-le") + b"\x00\x00"
        length, ln = len(payload), b""
        while True:
            b = length & 0x7F
            length >>= 7
            ln += bytes([b | 0x80]) if length else bytes([b])
            if not length:
                break
        return bytes([eid]) + ln + payload
    events = bytes([156]) + struct.pack("<I", int(bpm * 1000))
    for p in plugins:
        events += text_event(201, p)
    for p in paths:
        events += text_event(196, p)
    flhd = b"FLhd" + struct.pack("<I", 6) + struct.pack("<HHH", 0, 1, 96)
    return flhd + b"FLdt" + struct.pack("<I", len(events)) + events


def set_times(path: Path, ts: float) -> None:
    os.utime(path, (ts, ts))


# Installed plug-ins for the Plugins page: (file name, maker, formats, kind). The
# Linux folders (~/.vst3, ~/.clap, ~/.lv2) are where Backups looks by itself; the AU
# copies go in "Mac Plugins/Components", which the picture tests add as a folder.
INSTALLED = [
    ("Serum", "Xfer Records", "vst3 au vst2", "Instrument"), ("OTT", "Xfer Records", "vst3 au", "Fx"),
    ("LFOTool", "Xfer Records", "vst3 au", "Fx"), ("Vital", "Vital Audio", "vst3 clap vst2", "Instrument"),
    ("FabFilter Pro-Q 3", "FabFilter", "vst3 au clap", "Fx"), ("FabFilter Pro-L 2", "FabFilter", "vst3 au clap", "Fx"),
    ("FabFilter Saturn 2", "FabFilter", "vst3 au clap", "Fx"), ("ValhallaVintageVerb", "Valhalla DSP", "vst3 au clap", "Fx"),
    ("Decapitator", None, "vst3 au", "Fx"), ("Kontakt 7", "Native Instruments", "vst3 au", "Instrument"),
    ("Massive X", "Native Instruments", "vst3 au", "Instrument"), ("Omnisphere", "Spectrasonics", "vst3 au vst2", "Instrument"),
    ("RC-20 Retro Color", "XLN Audio", "vst3 au", "Fx"), ("Pigments", "Arturia", "vst3 au", "Instrument"),
    ("Diva", "u-he", "vst3 au clap", "Instrument"), ("Ozone 11 Maximizer", "iZotope", "vst3 au", "Fx"),
    ("Trackspacer", "Wavesfactory", "vst3 au", "Fx"), ("Surge XT", "Surge Synth Team", "vst3 clap lv2", "Instrument"),
    ("Dexed", None, "vst3 au", "Instrument"), ("TDR Nova", "Tokyo Dawn Records", "vst3 au clap", "Fx"),
    ("Phase Plant", "Kilohearts", "vst3 au clap", "Instrument"), ("LABS", "Spitfire Audio", "vst3 au", "Instrument"),
]


def seed_plugins(home: Path) -> int:
    made = 0
    for name, maker, formats, kind in INSTALLED:
        for fmt in formats.split():
            if fmt == "vst3":
                # makers without a description file are known by the folder they sit in
                base = home / ".vst3" / ("Soundtoys" if name == "Decapitator" else "")
                res = base / f"{name}.vst3" / "Contents" / "Resources"
                res.mkdir(parents=True, exist_ok=True)
                if maker:
                    (res / "moduleinfo.json").write_text(
                        '{"Factory Info": {"Vendor": "%s"}, "Classes": [{"Sub Categories": ["%s"]}]}' % (maker, kind))
            elif fmt == "au":
                c = home / "Mac Plugins" / "Components" / f"{name}.component" / "Contents"
                c.mkdir(parents=True, exist_ok=True)
                short = name.replace("FabFilter ", "")
                au_name = f"{maker or ('Soundtoys' if name == 'Decapitator' else 'Digital Suburban')}: {short}"
                with (c / "Info.plist").open("wb") as fh:
                    plistlib.dump({"AudioComponents": [{"name": au_name, "type": "aumu" if kind == "Instrument" else "aufx"}]}, fh)
            elif fmt == "clap":
                (home / ".clap").mkdir(parents=True, exist_ok=True)
                (home / ".clap" / f"{name}.clap").write_bytes(b"\0")
            elif fmt == "vst2":
                (home / ".vst").mkdir(parents=True, exist_ok=True)
                (home / ".vst" / f"{name}.so").write_bytes(b"\0")
            elif fmt == "lv2":
                (home / ".lv2" / f"{name}.lv2").mkdir(parents=True, exist_ok=True)
        made += 1
    return made


def main(workdir: str) -> None:
    root = Path(workdir).resolve()
    home = root / "home"
    music = home / "Music"
    # shared sample library (absolute references)
    splice_files = []
    for pack in SPLICE_PACKS:
        for w in RNG.sample(SAMPLE_WORDS["drums"] + SAMPLE_WORDS["music"], 6):
            p = music / pack / f"{w} {RNG.randint(1, 40):02d}.wav"
            if not p.exists():
                wav_bytes_silence(p, RNG.uniform(0.5, 4.0))
            splice_files.append(p)

    made = 0
    for name, daw, bpm, exported, missing, age in PROJECTS:
        ts = NOW - age * DAY - RNG.randint(0, 20000)
        plugins = RNG.sample(PLUGINS, RNG.randint(2, 6))
        tracks = RNG.randint(6, 24)
        local_names = [f"{w}.wav" for w in RNG.sample(SAMPLE_WORDS["drums"], 3) + RNG.sample(SAMPLE_WORDS["music"], 3)]
        shared = RNG.sample(splice_files, RNG.randint(2, 5))
        if daw == "als":
            folder = music / "Ableton" / "Projects" / f"{name} Project"
            proj = folder / f"{name}.als"
            rel_dir = "Samples/Imported"
        elif daw == "rpp":
            folder = music / "REAPER Projects" / name
            proj = folder / f"{name}.rpp"
            rel_dir = "Audio Files"
        else:
            folder = music / "FL Studio" / "Projects" / name
            proj = folder / f"{name}.flp"
            rel_dir = "Audio Files"
        folder.mkdir(parents=True, exist_ok=True)
        local_paths = []
        for i, ln in enumerate(local_names):
            p = folder / rel_dir / ln
            if not (missing and i < 2):  # a couple of samples gone missing
                wav_bytes_silence(p, RNG.uniform(1.0, 8.0))
                set_times(p, ts - DAY)
            local_paths.append(p)
        missing_abs = [music / "Splice/Sounds/packs/Old Laptop Pack" / "Vocal Shout 03.wav"] if missing else []

        if daw == "als":
            refs = [("rel", f"{rel_dir}/{ln}") for ln in local_names] + \
                   [("abs", str(p)) for p in shared + missing_abs]
            with gzip.open(proj, "wt", encoding="utf-8") as fh:
                fh.write(als_xml(float(bpm), tracks, plugins, refs))
            # Live keeps a Backup folder and an Ableton Project Info folder
            (folder / "Ableton Project Info").mkdir(exist_ok=True)
        elif daw == "rpp":
            files = [f"{rel_dir}/{ln}" for ln in local_names] + [str(p) for p in shared + missing_abs]
            proj.write_text(rpp_text(float(bpm), plugins, files))
        else:
            files = [str(p) for p in local_paths] + [str(p) for p in shared + missing_abs]
            proj.write_bytes(flp_bytes(float(bpm), plugins, files))
        set_times(proj, ts)

        if exported:
            versions = RNG.choice([["v3"], ["v2", "final"], ["master"], ["mix 1", "v4"]])
            for j, v in enumerate(versions):
                ep = folder / f"{name} {v}.wav"
                wav_song(ep, bpm, seconds=RNG.uniform(36, 60))
                set_times(ep, ts + 600 + j * 3600)
        set_times(folder, ts)
        made += 1
    print(f"seeded {made} projects under {music}")
    print(f"seeded {seed_plugins(home)} plug-ins under {home}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
