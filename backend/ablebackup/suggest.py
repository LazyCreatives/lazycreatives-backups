"""First-run help: the usual project folders that exist on this computer.

Setup shows these as ready-ticked rows ("Music / Ableton Projects · 42 projects") so
a new user ticks instead of browsing. Everything here is bounded — a depth cap per
folder and one time budget for the whole look — so a huge Music folder or a slow
network drive can never hang the welcome screen.
"""
import os
import time
from pathlib import Path
from typing import Optional

from ablebackup.daws.base import _keep_dirs
from ablebackup.daws.registry import DAW_REGISTRY, all_extensions, package_extensions

# Where DAWs keep projects by default, relative to the home folder. Same names on
# macOS, Windows and Linux (Windows' "Documents" is the same folder as "My Documents").
KNOWN_PLACES: list[tuple[str, ...]] = [
    ("Music", "Ableton"),
    ("Music", "Ableton Projects"),
    ("Music", "Logic"),
    ("Documents", "Ableton"),
    ("Documents", "Ableton Projects"),
    ("Documents", "Image-Line", "FL Studio", "Projects"),
    ("Documents", "FL Studio", "Projects"),
    ("Documents", "REAPER Media"),
    ("Documents", "Bitwig Studio", "Projects"),
    ("Documents", "Studio One", "Songs"),
]
# Folders to look through one level down for any folder that holds projects.
TOP_LEVELS: list[tuple[str, ...]] = [("Music",), ("Documents",), ("OneDrive", "Documents")]

# Never project homes even though they hold .als files: Ableton's own library and
# the demo songs that come with packs.
NOT_PROJECTS = {"User Library", "Factory Packs", "Packs", "Templates"}

COUNT_DEPTH = 4       # how deep to count under each suggested folder
SNIFF_DEPTH = 2       # how deep a top-level folder may hide its first project
TIME_BUDGET = 1.5     # seconds for the whole look


def _skip() -> set[str]:
    s: set[str] = set(NOT_PROJECTS)
    for a in DAW_REGISTRY:
        s |= a.skip_dirs()
    return s


def _walk(root: Path, max_depth: int, deadline: float, stop_at_first: bool) -> int:
    """Project files under `root`, at most `max_depth` folders down. Stops early at
    the deadline (or at the first hit when only asking "any?")."""
    exts = all_extensions()
    pkgs = package_extensions()  # Logic projects are folders, counted by name
    skip = _skip()
    found = 0
    base = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
        depth = len(Path(dirpath).parts) - base
        if pkgs:
            packages = [d for d in dirnames if d.lower().endswith(pkgs)]
            if packages:
                found += len(packages)
                if stop_at_first:
                    return found
                dirnames[:] = [d for d in dirnames if d not in packages]
        dirnames[:] = _keep_dirs(dirnames, skip) if depth < max_depth else []
        for fn in filenames:
            if fn.lower().endswith(exts):
                found += 1
                if stop_at_first:
                    return found
        if time.monotonic() > deadline:
            break
    return found


def _label(path: Path, home: Path) -> str:
    try:
        return " / ".join(path.relative_to(home).parts)
    except ValueError:
        return str(path)


def _inside(child: Path, parent: Path) -> bool:
    return child != parent and parent in child.parents


def suggested_folders(home: Optional[Path] = None, budget: float = TIME_BUDGET) -> list[dict]:
    """[{path, label, count}] for the usual project folders that exist here and hold
    at least one project, most projects first."""
    home = Path(home) if home else Path.home()
    deadline = time.monotonic() + budget
    candidates: list[Path] = []

    def add(p: Path) -> None:
        if p not in candidates and p.is_dir() and p.name not in NOT_PROJECTS:
            candidates.append(p)

    for parts in KNOWN_PLACES:
        add(home.joinpath(*parts))
    skip = _skip()
    for parts in TOP_LEVELS:
        top = home.joinpath(*parts)
        try:
            kids = sorted(e.name for e in os.scandir(top) if e.is_dir(follow_symlinks=False))
        except OSError:
            continue
        for name in _keep_dirs(kids, skip):
            if time.monotonic() > deadline:
                break
            p = top / name
            if p not in candidates and _walk(p, SNIFF_DEPTH, deadline, stop_at_first=True):
                add(p)

    counts: dict[Path, int] = {}
    for p in candidates:
        if time.monotonic() > deadline:
            break
        n = _walk(p, COUNT_DEPTH, deadline, stop_at_first=False)
        if n > 0:
            counts[p] = n

    # One folder inside another: offer just one. A wide folder (Documents/Image-Line)
    # that only holds what its usual subfolder (…/FL Studio/Projects) holds gives way
    # to the subfolder; one with more projects of its own takes the subfolder's place.
    for outer in sorted(counts, key=lambda p: len(p.parts)):
        if outer not in counts:
            continue
        inner = [p for p in counts if _inside(p, outer)]
        if not inner:
            continue
        if counts[outer] <= sum(counts[p] for p in inner if not any(_inside(p, q) for q in inner)):
            del counts[outer]
        else:
            for p in inner:
                del counts[p]

    out = [{"path": str(p), "label": _label(p, home), "count": n} for p, n in counts.items()]
    out.sort(key=lambda d: (-d["count"], d["label"].lower()))
    return out
