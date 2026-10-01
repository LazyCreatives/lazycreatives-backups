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

from ablebackup.daws.base import COMMON_SKIP

# Index only plausible audio/media files — keeps the index small and relevant.
AUDIO_EXTS = {
    ".wav", ".aif", ".aiff", ".aifc", ".flac", ".mp3", ".m4a", ".ogg",
    ".wv", ".caf", ".aac", ".mov", ".mp4", ".m4v",
}
# Reuse the shared skip set so the locator never descends into ANY DAW's backup
# destination (AbletonBackups/FLStudioBackups/ReaperBackups/DAWprojectBackups/
# Backup/Backups) — otherwise a "missing" sample could relink to a copy living in a
# previous backup pool/snapshot rather than the real library.
_SKIP_DIRS = COMMON_SKIP | {"Ableton Project Info", "_pool", "_External"}


def default_libraries() -> list[Path]:
    """Sample libraries we can auto-detect (today: the Splice download folder)."""
    out: list[Path] = []
    splice = Path.home() / "Splice"
    if splice.is_dir():
        out.append(splice)
    return out


def build_index(roots: list[Path]) -> dict[str, list[Path]]:
    """Map lowercased filename -> all paths with that name, for audio files under
    roots. Returns every candidate (not first-wins) so the caller can verify which
    one actually matches — a basename can be shared by many different samples."""
    index: dict[str, list[Path]] = {}
    for root in roots:
        if not Path(root).is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            for fn in filenames:
                if Path(fn).suffix.lower() in AUDIO_EXTS:
                    index.setdefault(fn.lower(), []).append(Path(dirpath) / fn)
    return index


def make_locator(roots: list[Path]) -> Callable[[str], list[Path]]:
    """Build the index once and return locate(name) -> all same-named candidates."""
    index = build_index(roots)

    def locate(name: str) -> list[Path]:
        if not name:
            return []
        return index.get(Path(name).name.lower(), [])

    return locate
