"""Find samples that are missing from their referenced path by searching the
user's local sample libraries (e.g. the Splice folder) and source folders.

Splice has no usable public API, but every downloaded sample already lives on
disk under ~/Splice/sounds/packs/... in a flat, predictable layout — so a
filename index over those folders lets us relink a "missing" sample to a real
copy without any network call.
"""
import os
from pathlib import Path
from typing import Callable, Optional

# Index only plausible audio/media files — keeps the index small and relevant.
AUDIO_EXTS = {
    ".wav", ".aif", ".aiff", ".aifc", ".flac", ".mp3", ".m4a", ".ogg",
    ".wv", ".caf", ".aac", ".mov", ".mp4", ".m4v",
}
_SKIP_DIRS = {"Backup", "AbletonBackups", "Ableton Project Info", "_pool", "_External"}


def default_libraries() -> list[Path]:
    """Sample libraries we can auto-detect (today: the Splice download folder)."""
    out: list[Path] = []
    splice = Path.home() / "Splice"
    if splice.is_dir():
        out.append(splice)
    return out


def build_index(roots: list[Path]) -> dict[str, Path]:
    """Map lowercased filename -> a path, for audio files under roots. First wins."""
    index: dict[str, Path] = {}
    for root in roots:
        if not Path(root).is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            for fn in filenames:
                if Path(fn).suffix.lower() in AUDIO_EXTS:
                    key = fn.lower()
                    if key not in index:
                        index[key] = Path(dirpath) / fn
    return index


def make_locator(roots: list[Path]) -> Callable[[str], Optional[Path]]:
    """Build the index once and return locate(name) -> a found path or None."""
    index = build_index(roots)

    def locate(name: str) -> Optional[Path]:
        if not name:
            return None
        return index.get(Path(name).name.lower())

    return locate
