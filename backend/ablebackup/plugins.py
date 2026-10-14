"""The plug-ins installed on this computer, for the Plugins page.

Looks in the usual plug-in folders for Windows, Mac and Linux (plus any folders
the producer adds) and lists what is there: name, maker, the formats it comes in
(VST3, VST2, AU, CLAP, AAX, LV2) and where each one lives. Nothing is loaded or
run: names come from the file names, and the maker from the plug-in's own
description file when it has one (Mac bundles, newer VST3s), else from the folder
it sits in ("VST3/FabFilter/Pro-Q 3.vst3" is by FabFilter).

The page also shows how many scanned projects use each plug-in, by matching the
plug-in names projects keep (see ``used_in``).
"""
from __future__ import annotations

import mmap
import os
import platform
import plistlib
import re
import time
from pathlib import Path

# Extension -> format. .dll / .so are VST2 on Windows / Linux; .vst is a VST2
# bundle on a Mac. A bundle (a folder ending in one of these) is one plug-in.
_EXT_FORMAT = {
    ".vst3": "VST3", ".component": "AU", ".clap": "CLAP", ".aaxplugin": "AAX",
    ".lv2": "LV2", ".vst": "VST2", ".dll": "VST2", ".so": "VST2",
}
FORMAT_ORDER = ["VST3", "AU", "CLAP", "VST2", "AAX", "LV2"]

_MAX_ENTRIES = 200_000   # folder entries looked at, in all, before stopping
_MAX_DEPTH = 6           # folders deep under each plug-in folder
_DEADLINE = 25.0         # seconds
_FILE_DEADLINE = 20.0    # seconds spent reading plug-in files for their type, per look
SCAN_VERSION = 2         # a kept look from before this is looked at again

# Audio Unit types (the "type" in a bundle's Info.plist) -> instrument or effect.
_AU_KIND = {"aumu": "Instrument", "augn": "Instrument", "aufx": "Effect", "aumf": "Effect",
            "aumi": "Effect", "aufc": "Effect", "aupn": "Effect", "auol": "Effect", "aumx": "Effect"}

# Folder names that say nothing about who made the plug-in inside.
_NOT_A_MAKER = {"vst", "vst2", "vst3", "vstplugins", "plugins", "plug-ins", "plugin", "clap", "lv2",
                "components", "x64", "x86", "64bit", "64-bit", "32bit", "32-bit", "win64", "win32",
                "common files", "contents", "effects", "instruments", "fx", "synths", "other",
                "au", "aax", "audio units", "audiounits", "audio unit", "vst3 plugins", "vst plugins", "clap plugins"}


def standard_folders(system: str | None = None, env: dict | None = None,
                     home: Path | None = None) -> list[Path]:
    """The usual plug-in folders for this kind of computer (they may not all exist)."""
    system = system or platform.system()
    env = os.environ if env is None else env
    home = home or Path.home()
    if system == "Windows":
        pf = env.get("ProgramFiles") or r"C:\Program Files"
        pf86 = env.get("ProgramFiles(x86)") or r"C:\Program Files (x86)"
        common = env.get("CommonProgramFiles") or os.path.join(pf, "Common Files")
        local = env.get("LOCALAPPDATA") or str(home / "AppData" / "Local")
        out = [
            os.path.join(common, "VST3"), os.path.join(local, "Programs", "Common", "VST3"),
            os.path.join(common, "CLAP"), os.path.join(local, "Programs", "Common", "CLAP"),
            os.path.join(pf, "VSTPlugins"), os.path.join(pf, "Steinberg", "VSTPlugins"),
            os.path.join(common, "VST2"), os.path.join(common, "Steinberg", "VST2"),
            os.path.join(pf86, "VSTPlugins"), os.path.join(pf86, "Steinberg", "VSTPlugins"),
            os.path.join(common, "Avid", "Audio", "Plug-Ins"),
        ]
        return [Path(p) for p in out]
    if system == "Darwin":
        out: list[Path] = []
        for base in (Path("/Library"), home / "Library"):
            out += [base / "Audio" / "Plug-Ins" / n for n in ("VST3", "Components", "CLAP", "VST")]
        out.append(Path("/Library/Application Support/Avid/Audio/Plug-Ins"))
        return out
    # Linux and the rest
    out = []
    for name in ("vst3", "clap", "vst", "lxvst", "lv2"):
        out += [home / f".{name}", Path("/usr/lib") / name, Path("/usr/local/lib") / name]
    return out


def _clean_name(stem: str) -> str:
    """'Serum_x64' -> 'Serum'; keeps the name as the maker wrote it otherwise."""
    s = re.sub(r"[\s_.-]*\(?(x64|x86_64|64[\s_-]?bit|win64|x86|32[\s_-]?bit)\)?$", "", stem, flags=re.I)
    return s.strip() or stem


def key(name: str) -> str:
    """How two plug-in names are compared: no case, no spaces or punctuation, no
    '(Maker)' after it, no '64-bit' tags. 'Serum (Xfer Records)' == 'serum'."""
    s = re.sub(r"\s*\([^)]*\)\s*$", "", name or "")
    s = _clean_name(s)
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _maker_from_copyright(text: str) -> str:
    s = re.sub(r"(?i)\b(all rights reserved|copyright|inc|ltd|llc|gmbh|s\.?a\.?s|limited)\b\.?", " ", text or "")
    s = re.sub(r"©|\(c\)|\b(19|20)\d\d\b(\s*[-–]\s*(19|20)?\d\d)?", " ", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" ,.;:-")
    return s if 1 < len(s) <= 40 else ""


def _read_bundle(bundle: Path, fmt: str) -> dict:
    """Name, maker and kind (instrument / effect) from a bundle's own description
    files, when it has them. Nothing here is required."""
    out: dict = {}
    plist = bundle / "Contents" / "Info.plist"
    if plist.is_file():
        try:
            with plist.open("rb") as fh:
                info = plistlib.load(fh)
        except Exception:
            info = {}
        comps = info.get("AudioComponents") if isinstance(info, dict) else None
        comps = [c for c in comps if isinstance(c, dict)] if isinstance(comps, list) else []
        if comps:
            full = str(comps[0].get("name") or "")
            if ":" in full:
                maker, name = full.split(":", 1)
                out["maker"], out["name"], out["rank"] = maker.strip(), name.strip(), 3
            # A bundle can hold more than one (an instrument and its effect version):
            # the first one with a type Backups knows says what it is.
            for c in comps:
                kind = _AU_KIND.get(str(c.get("type") or "").strip().lower())
                if kind:
                    out["kind"], out["kind_rank"] = kind, 3
                    break
        if isinstance(info, dict) and not out.get("maker"):
            maker = _maker_from_copyright(str(info.get("NSHumanReadableCopyright") or info.get("CFBundleGetInfoString") or ""))
            if maker:
                out["maker"] = maker
    if fmt == "VST3":
        mi = bundle / "Contents" / "Resources" / "moduleinfo.json"
        if mi.is_file():
            try:
                text = mi.read_text(errors="ignore")[:200_000]
            except OSError:
                text = ""
            m = re.search(r'"Vendor"\s*:\s*"([^"]+)"', text)
            if m and not out.get("maker"):
                out["maker"] = m.group(1).strip()
            if "kind" not in out:
                if re.search(r'"Sub Categories"\s*:\s*\[[^\]]*"Instrument', text):
                    out["kind"], out["kind_rank"] = "Instrument", 3
                elif re.search(r'"Sub Categories"\s*:\s*\[[^\]]*"Fx', text):
                    out["kind"], out["kind_rank"] = "Effect", 3
    return out


# A VST3's own type ("Instrument|Synth", "Fx|EQ") and a CLAP's ("instrument",
# "audio-effect") are written inside the plug-in file as plain text, even when the
# bundle has no description file (most VST3s and every CLAP). Backups reads the file
# for that text; nothing in it is run.
_VST3_SUB = re.compile(rb"(Instrument|Fx)(\|[A-Za-z0-9 ]{1,24}){0,4}")
_MAX_FILE = 400 * 1024 * 1024


def _plugin_file(place: str) -> Path | None:
    """The file with the plug-in's code in it: the place itself, or for a bundle the
    first file in Contents/MacOS, Contents/x86_64-win, Contents/x86_64-linux and so on."""
    p = Path(place)
    try:
        if p.is_file():
            return p
        subs = sorted(d for d in (p / "Contents").iterdir() if d.is_dir() and d.name not in ("Resources", "_CodeSignature", "Frameworks", "PlugIns"))
    except OSError:
        return None
    for d in subs:
        try:
            files = sorted(f for f in d.iterdir() if f.is_file() and f.suffix.lower() in ("", ".vst3", ".clap", ".so", ".dll"))
        except OSError:
            continue
        if files:
            return files[0]
    return None


def _all_at(mm, word: bytes):
    """Each place ``word`` starts a piece of text in the file (a 0 byte just before)."""
    i = mm.find(b"\0" + word)
    while i >= 0:
        yield i + 1
        i = mm.find(b"\0" + word, i + 1)


def kind_from_file(path: Path, fmt: str) -> str:
    """'Instrument', 'Effect' or '' from the text inside a VST3 or CLAP plug-in file."""
    try:
        size = path.stat().st_size
        if not 0 < size <= _MAX_FILE:
            return ""
        with path.open("rb") as fh, mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            if fmt == "CLAP":
                inst = mm.find(b"\0instrument\0") >= 0
                fx = mm.find(b"\0audio-effect\0") >= 0 or mm.find(b"\0note-effect\0") >= 0
                return "Instrument" if inst and not fx else "Effect" if fx and not inst else ""
            found = {"Instrument": [], "Fx": []}
            for word in found:
                for i, start in enumerate(_all_at(mm, word.encode())):
                    if i > 2000:
                        break
                    end = mm.find(b"\0", start, start + 120)
                    m = _VST3_SUB.fullmatch(mm[start:end]) if end > 0 else None
                    if m:
                        found[word].append(m.group(0))
            piped = lambda w: any(b"|" in t for t in found[w])
            # "Instrument|Synth" says it plainly. A plain "Fx" is in lots of plug-ins'
            # own words, so an effect needs "Fx|Something", or a plain "Fx" with no
            # "Instrument" anywhere.
            if piped("Instrument"):
                return "Instrument"
            if piped("Fx"):
                return "Effect"
            if found["Instrument"]:
                return "Instrument"
            return "Effect" if found["Fx"] else ""
    except (OSError, ValueError):
        return ""


def _documents(env: dict, home: Path) -> list[Path]:
    out = [home / "Documents"]
    for k in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        if env.get(k):
            out.append(Path(env[k]) / "Documents")
    if env.get("USERPROFILE"):
        out.append(Path(env["USERPROFILE"]) / "OneDrive" / "Documents")
    return out


def daw_lists(system: str | None = None, env: dict | None = None, home: Path | None = None) -> dict:
    """What the music programs on this computer already worked out about each plug-in:
    FL Studio's plug-in database files sit in an Effects or a Generators folder, and
    Reaper marks instruments in its plug-in lists ("!!!VSTi", "<inst>"). Read only.
    Returns ``{"paths": {path: kind}, "names": {key: kind}}``."""
    system = system or platform.system()
    env = os.environ if env is None else env
    home = home or Path.home()
    paths: dict[str, str] = {}
    names: dict[str, str] = {}

    def add_name(n: str, kind: str) -> None:
        k = key(n)
        if k:
            names.setdefault(k, kind)

    # FL Studio: Documents/Image-Line/FL Studio/Presets/Plugin database/Installed/{Effects,Generators}
    left = 20_000
    for docs in _documents(env, home):
        inst = docs / "Image-Line" / "FL Studio" / "Presets" / "Plugin database" / "Installed"
        for folder, kind in (("Generators", "Instrument"), ("Effects", "Effect")):
            base = inst / folder
            if not base.is_dir():
                continue
            for dirpath, _dirs, files in os.walk(base):
                for f in files:
                    left -= 1
                    if left < 0:
                        break
                    stem, ext = os.path.splitext(f)
                    if ext.lower() not in (".nfo", ".fst"):
                        continue
                    add_name(stem, kind)
                    if ext.lower() == ".nfo":
                        try:
                            text = Path(dirpath, f).read_text(errors="ignore")[:20_000]
                        except OSError:
                            continue
                        for m in re.finditer(r"(?m)^ps_file_filename_\d+=(.+?)\s*$", text):
                            paths.setdefault(os.path.normcase(m.group(1)), kind)
    # Reaper's plug-in lists
    if system == "Windows":
        rdirs = [Path(env.get("APPDATA") or home / "AppData" / "Roaming") / "REAPER"]
    elif system == "Darwin":
        rdirs = [home / "Library" / "Application Support" / "REAPER"]
    else:
        rdirs = [Path(env.get("XDG_CONFIG_HOME") or home / ".config") / "REAPER"]
    for rdir in rdirs:
        try:
            inis = sorted(rdir.glob("reaper-vstplugins*.ini")) + sorted(rdir.glob("reaper-auplugins*.ini"))
        except OSError:
            continue
        for ini in inis:
            try:
                lines = ini.read_text(errors="ignore").splitlines()[:50_000]
            except OSError:
                continue
            au = "auplugins" in ini.name
            for line in lines:
                if "=" not in line or line.startswith("["):
                    continue
                left_s, val = line.split("=", 1)
                if au:
                    v = val.strip().lower()
                    kind = "Instrument" if v == "<inst>" else "Effect" if v == "<!inst>" else ""
                    if kind:
                        add_name(left_s.split(":", 1)[-1], kind)
                        add_name(left_s, kind)
                    continue
                parts = val.split(",", 2)
                if len(parts) < 3 or not parts[2].strip() or "<SHELL>" in parts[2]:
                    continue
                name = parts[2].strip()
                kind = "Instrument" if name.endswith("!!!VSTi") else "Effect"
                add_name(name.replace("!!!VSTi", ""), kind)
                if "<" not in left_s:
                    add_name(_clean_name(os.path.splitext(left_s)[0]), kind)
    return {"paths": paths, "names": names}


def _maker_from_folder(path: Path, root: Path) -> str:
    try:
        parts = path.relative_to(root).parts[:-1]
    except ValueError:
        return ""
    for p in parts:
        if p.lower() not in _NOT_A_MAKER and not _EXT_FORMAT.get(Path(p).suffix.lower()):
            return p
    return ""


def _walk(root: Path, budget: dict, found: list[dict], deadline: float) -> int:
    """Every plug-in under one folder. Returns how many it found there."""
    n = 0
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack:
        here, depth = stack.pop()
        if time.monotonic() > deadline or budget["left"] <= 0:
            break
        try:
            entries = list(os.scandir(here))
        except OSError:
            continue
        budget["left"] -= len(entries)
        for e in entries:
            fmt = _EXT_FORMAT.get(os.path.splitext(e.name)[1].lower())
            try:
                is_dir = e.is_dir()  # follows links, as plug-in folders often are links
            except OSError:
                continue
            if fmt and (is_dir or fmt not in ("LV2",)):
                if fmt == "VST2" and is_dir and e.name.lower().endswith((".dll", ".so")):
                    continue
                p = Path(e.path)
                item = {"name": _clean_name(os.path.splitext(e.name)[0]), "format": fmt, "path": str(p),
                        "maker": "", "kind": "", "kind_rank": 0, "rank": 0}
                if is_dir:
                    item.update({k: v for k, v in _read_bundle(p, fmt).items() if v})
                    if item["maker"] and not item["rank"]:
                        item["rank"] = 2
                if not item["maker"]:
                    item["maker"] = _maker_from_folder(p, root)
                    item["rank"] = 1 if item["maker"] else 0
                found.append(item)
                n += 1
            elif is_dir and depth < _MAX_DEPTH and not e.name.startswith("."):
                stack.append((Path(e.path), depth + 1))
    return n


def scan(extra: list[str] | None = None, folders: list[Path] | None = None,
         deadline_s: float = _DEADLINE, kind_cache: list[dict] | None = None,
         daws: dict | None = None, file_deadline_s: float = _FILE_DEADLINE) -> dict:
    """Look in the plug-in folders and list what is installed.

    Returns ``{"plugins": [...], "folders": [...], "scanned_at": ..., "complete": bool}``.
    Each plug-in is one row however many formats it comes in: ``formats`` lists them
    and ``places`` says where each one is. ``kind`` (Instrument / Effect / '') comes
    from the plug-in's own description, else from what FL Studio or Reaper on this
    computer say, else from the text in its file; ``kind_cache`` is the last look's,
    so files that haven't changed aren't read again."""
    deadline = time.monotonic() + deadline_s
    budget = {"left": _MAX_ENTRIES}
    std = folders if folders is not None else standard_folders()
    mine = [Path(p) for p in (extra or []) if p]
    seen_roots: set[str] = set()
    found: list[dict] = []
    folder_rows = []
    for root, yours in [(p, False) for p in std] + [(p, True) for p in mine]:
        k = os.path.normcase(str(root))
        if k in seen_roots:
            continue
        seen_roots.add(k)
        exists = root.is_dir()
        count = _walk(root, budget, found, deadline) if exists else 0
        if exists or yours:
            folder_rows.append({"path": str(root), "yours": yours, "exists": exists, "count": count})
    # The same plug-in as VST3 and AU (and so on) is one row.
    rows: dict[str, dict] = {}
    seen_paths: set[str] = set()
    for f in found:
        if f["path"] in seen_paths:
            continue
        seen_paths.add(f["path"])
        k = key(f["name"])
        row = rows.get(k)
        if row is None:
            row = rows[k] = {"id": k, "name": f["name"], "maker": "", "kind": "", "formats": [], "places": [], "_rank": 0, "_kind_rank": 0}
        row["places"].append({"format": f["format"], "path": f["path"]})
        if f["format"] not in row["formats"]:
            row["formats"].append(f["format"])
        # the plug-in's own description beats a folder name; an AU's says both
        if f["rank"] > row["_rank"]:
            row["maker"], row["_rank"] = f["maker"], f["rank"]
            if f["rank"] == 3:
                row["name"] = f["name"]
        if f["kind"] and f["kind_rank"] > row["_kind_rank"]:
            row["kind"], row["_kind_rank"] = f["kind"], f["kind_rank"]
    # "Pro-Q 3.component" by FabFilter and "FabFilter Pro-Q 3.vst3" are one plug-in too.
    for k in list(rows):
        row = rows.get(k)
        mk = key(row["maker"]) if row else ""
        other = rows.get(mk + k) if mk else None
        if row and other and other is not row:
            for p in other["places"]:
                row["places"].append(p)
                if p["format"] not in row["formats"]:
                    row["formats"].append(p["format"])
            if other["_kind_rank"] > row["_kind_rank"]:
                row["kind"], row["_kind_rank"] = other["kind"], other["_kind_rank"]
            del rows[mk + k]
    # No type yet: what the music programs here say, then the text in the file itself.
    lists = daw_lists() if daws is None else daws
    old = {c["path"]: c for c in (kind_cache or []) if isinstance(c, dict) and c.get("path")}
    cache: list[dict] = []
    file_deadline = time.monotonic() + file_deadline_s
    for row in rows.values():
        if row["_kind_rank"] < 2:
            kind = next((lists["paths"][os.path.normcase(p["path"])] for p in row["places"]
                         if os.path.normcase(p["path"]) in lists["paths"]), "")
            if not kind:
                k, mk = row["id"], key(row["maker"])
                ks = [k, mk + k if mk else "", k[len(mk):] if mk and k.startswith(mk) and len(k) > len(mk) + 1 else ""]
                kind = next((lists["names"][x] for x in ks if x and x in lists["names"]), "")
            if kind:
                row["kind"], row["_kind_rank"] = kind, 2
                continue
        if row["_kind_rank"]:
            continue
        for p in row["places"]:
            if p["format"] not in ("VST3", "CLAP"):
                continue
            f = _plugin_file(p["path"])
            if f is None:
                continue
            try:
                st = f.stat()
            except OSError:
                continue
            c = old.get(str(f))
            if c and c.get("size") == st.st_size and c.get("mtime") == st.st_mtime:
                kind = c.get("kind") or ""
            elif time.monotonic() > file_deadline:
                continue
            else:
                kind = kind_from_file(f, p["format"])
            cache.append({"path": str(f), "size": st.st_size, "mtime": st.st_mtime, "kind": kind})
            if kind:
                row["kind"], row["_kind_rank"] = kind, 1
                break
    out = []
    for row in rows.values():
        row.pop("_rank", None)
        row.pop("_kind_rank", None)
        row["formats"].sort(key=FORMAT_ORDER.index)
        row["places"].sort(key=lambda p: (FORMAT_ORDER.index(p["format"]), p["path"].lower()))
        out.append(row)
    out.sort(key=lambda r: (r["name"].lower(), r["id"]))
    return {"plugins": out, "folders": folder_rows, "scanned_at": time.time(),
            "complete": time.monotonic() <= deadline and budget["left"] > 0,
            "version": SCAN_VERSION, "kind_cache": cache}


def used_in(plugins: list[dict], projects: list[dict]) -> None:
    """Add ``used_in`` (how many projects use it) and ``used_by`` (a few of their
    names) to each plug-in. A project's plug-in name matches when it is the same
    name, or the same name with the maker in front ("Pro-Q 3" is "FabFilter Pro-Q 3")."""
    by_key: dict[str, list[str]] = {}
    for p in projects:
        for k in {key(n) for n in (p.get("plugins") or []) if n}:
            if k:
                by_key.setdefault(k, []).append(p.get("name") or "")
    for row in plugins:
        names: list[str] = []
        k = row["id"]
        mk = key(row.get("maker") or "")
        keys = {k}
        if mk and k.startswith(mk) and len(k) > len(mk) + 1:
            keys.add(k[len(mk):])   # file "FabFilter Pro-Q 3", project "Pro-Q 3"
        if mk:
            keys.add(mk + k)        # file "Pro-Q 3", project "FabFilter Pro-Q 3"
        for kk in keys:
            for n in by_key.get(kk, []):
                if n not in names:
                    names.append(n)
        row["used_in"] = len(names)
        row["used_by"] = sorted(names, key=str.lower)[:8]


# Plug-ins that come with the music program itself: never "missing", because the
# program brings them along wherever the project opens. Compared with ``key``.
_STOCK = {
    "flstudio": {
        "3xosc", "autogun", "beepmap", "boobass", "dashboard", "directwave", "drumaxx", "drumpad",
        "edison", "envelopecontroller", "fastdist", "flex", "fpc", "flkeys", "formulacontroller",
        "gms", "grossbeat", "harmless", "harmor", "kepler", "keplerexo", "layer", "maximus",
        "midiout", "minisynth", "morphine", "ogun", "patcher", "plucked", "poizone", "sakura",
        "sawer", "simsynth", "slicex", "slicer", "soundgoodizer", "sytrus", "toxicbiohazard",
        "transistorbass", "transientprocessor", "vfxkeyboardsplitter", "vocodex", "wasp",
        "waspxt", "wavetraveller", "pitcher", "newtone", "newtime", "hardcore", "effector",
        "convolver", "parametriceq2", "frequencyshifter", "frequencysplitter", "luxeverb",
        "multibanddelay", "vintagechorus", "vintagephaser", "pitchshifter", "distructor",
        "emaxxer", "spectrumanalyzer", "audiorecorder", "channelsampler", "audioclip",
        "automationclip", "sampler", "fruitykick", "fruitydance", "vfxsequencer", "zgameeditorvisualizer",
        "ftpdelay", "flstudiomobile", "pitchresonator", "vintagechorus", "gopher",
    },
    "studioone": {
        "proeq", "proeq2", "proeq3", "compressor", "fatchannel", "fatchannelxt", "limiter", "limiter2",
        "gate", "expander", "tricomp", "multibanddynamics", "channelstrip", "roomreverb", "mixverb",
        "openair", "openair2", "analogdelay", "beatdelay", "groovedelay", "autofilter", "chorus",
        "flange", "phaser", "rotor", "redlightdist", "ampire", "ampirext", "binauralpan",
        "dualpan", "mixtool", "tuner", "spectrummeter", "scope", "phasemeter", "levelmeter",
        "pipeline", "pipelinext", "pipelinestereo", "xtrem", "bitcrusher", "analogdelay",
        "vocoder", "autoshaper", "splitter", "eventfx", "mojito", "maitai", "presence",
        "presencext", "sampleone", "sampleonext", "impact", "impactxt", "mojitosynth",
        "deepflight", "fxchain", "notefx", "inputfilter", "multiinstrument",
    },
}


def _stock(name: str, daw: str) -> bool:
    k = key(name)
    if k.startswith("fruity") and daw == "flstudio":
        return True
    if daw == "reaper" and (k.startswith("rea") or name.lower().startswith(("js:", "jsfx"))):
        return True   # ReaPlugs and JS effects install with Reaper
    return k in _STOCK.get(daw, set())


def missing(plugins: list[dict], projects: list[dict]) -> list[dict]:
    """Plug-ins scanned projects use that aren't on this computer: one row per name,
    with how many projects use it and a few of their names (``used_by``). A name
    counts as here under the same matching as ``used_in``; plug-ins that come with
    the project's own music program are left out."""
    have: set[str] = set()
    for row in plugins:
        k, mk = row["id"], key(row.get("maker") or "")
        have.add(k)
        if mk and k.startswith(mk) and len(k) > len(mk) + 1:
            have.add(k[len(mk):])
        if mk:
            have.add(mk + k)
    out: dict[str, dict] = {}
    for p in projects:
        daw = (p.get("daw") or "").lower()
        for n in p.get("plugins") or []:
            k = key(n)
            if not k or k in have or _stock(n, daw):
                continue
            row = out.setdefault(k, {"id": k, "name": _clean_name(re.sub(r"\s*\([^)]*\)\s*$", "", n)) or n,
                                     "used_by": []})
            name = p.get("name") or ""
            if name not in row["used_by"]:
                row["used_by"].append(name)
    rows = list(out.values())
    for r in rows:
        r["used_in"] = len(r["used_by"])
        r["used_by"] = sorted(r["used_by"], key=str.lower)[:8]
    rows.sort(key=lambda r: (-r["used_in"], r["name"].lower()))
    return rows
