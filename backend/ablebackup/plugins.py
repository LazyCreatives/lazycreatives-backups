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

# Folder names that say nothing about who made the plug-in inside.
_NOT_A_MAKER = {"vst", "vst2", "vst3", "vstplugins", "plugins", "plug-ins", "plugin", "clap", "lv2",
                "components", "x64", "x86", "64bit", "64-bit", "32bit", "32-bit", "win64", "win32",
                "common files", "contents", "effects", "instruments", "fx", "synths", "other"}


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
        if isinstance(comps, list) and comps and isinstance(comps[0], dict):
            full = str(comps[0].get("name") or "")
            if ":" in full:
                maker, name = full.split(":", 1)
                out["maker"], out["name"], out["rank"] = maker.strip(), name.strip(), 3
            kind = str(comps[0].get("type") or "")
            if kind in ("aumu", "aumi"):
                out["kind"] = "Instrument"
            elif kind in ("aufx", "aumf"):
                out["kind"] = "Effect"
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
                    out["kind"] = "Instrument"
                elif re.search(r'"Sub Categories"\s*:\s*\[[^\]]*"Fx', text):
                    out["kind"] = "Effect"
    return out


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
                        "maker": "", "kind": "", "rank": 0}
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
         deadline_s: float = _DEADLINE) -> dict:
    """Look in the plug-in folders and list what is installed.

    Returns ``{"plugins": [...], "folders": [...], "scanned_at": ..., "complete": bool}``.
    Each plug-in is one row however many formats it comes in: ``formats`` lists them
    and ``places`` says where each one is."""
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
            row = rows[k] = {"id": k, "name": f["name"], "maker": "", "kind": "", "formats": [], "places": [], "_rank": 0}
        row["places"].append({"format": f["format"], "path": f["path"]})
        if f["format"] not in row["formats"]:
            row["formats"].append(f["format"])
        # the plug-in's own description beats a folder name; an AU's says both
        if f["rank"] > row["_rank"]:
            row["maker"], row["_rank"] = f["maker"], f["rank"]
            if f["rank"] == 3:
                row["name"] = f["name"]
        if f["kind"] and not row["kind"]:
            row["kind"] = f["kind"]
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
            row["kind"] = row["kind"] or other["kind"]
            del rows[mk + k]
    out = []
    for row in rows.values():
        row.pop("_rank", None)
        row["formats"].sort(key=FORMAT_ORDER.index)
        row["places"].sort(key=lambda p: (FORMAT_ORDER.index(p["format"]), p["path"].lower()))
        out.append(row)
    out.sort(key=lambda r: (r["name"].lower(), r["id"]))
    return {"plugins": out, "folders": folder_rows, "scanned_at": time.time(),
            "complete": time.monotonic() <= deadline and budget["left"] > 0}


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
