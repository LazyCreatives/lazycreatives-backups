"""The DAW adapter interface. One adapter per DAW; the rest of the pipeline is neutral."""
import os
from pathlib import Path
from typing import Iterable, Protocol

from ablebackup.models import FileRef

# Every DAW's destination subfolder — scanners skip these so a scan of the dest
# (or a source that overlaps it) never descends into prior backups.
BACKUP_ROOTS = {"AbletonBackups", "FLStudioBackups", "ReaperBackups",
                "DAWprojectBackups", "AudacityBackups", "LogicBackups",
                "StudioOneBackups", "BitwigBackups"}
COMMON_SKIP = {"Backup", "Backups"} | BACKUP_ROOTS

# Trees that never hold DAW projects but are huge — pruning them keeps a whole-Mac
# walk fast and TCC-quiet. Applied to every scan (these are never project homes);
# matched by exact dir name, plus hidden dirs and macOS package bundles below.
HEAVY_SKIP = {
    # macOS
    "Library", "Applications", "System", "private", "usr", "bin", "sbin",
    "opt", "dev", "cores", "Network", ".Trash", "Caches", "DerivedData",
    # Windows
    "Windows", "Program Files", "Program Files (x86)", "ProgramData",
    "$Recycle.Bin", "$WinREAgent", "Recovery", "AppData", "Windows.old",
    "MSOCache", "PerfLogs", "System Volume Information",
    # cross-platform dev/cache junk
    "node_modules", "site-packages", "__pycache__", ".gradle", "target",
}
_BUNDLE_SUFFIXES = (".app", ".photoslibrary", ".musiclibrary", ".tvlibrary",
                    ".framework", ".bundle", ".lproj", ".xcodeproj", ".plugin", ".vst3")


def _keep_dirs(dirnames: list[str], skip_dirs: set[str]) -> list[str]:
    """Subdirs worth descending: drop backup roots, heavy/system trees, hidden dirs
    (dotfolders), and macOS package bundles (which look like dirs but aren't projects)."""
    keep = []
    for d in dirnames:
        if d in skip_dirs or d in HEAVY_SKIP:
            continue
        if d.startswith("."):                       # .git, .cache, .Trash, dotfiles
            continue
        if d.endswith(_BUNDLE_SUFFIXES):             # Foo.app / Photos Library.photoslibrary
            continue
        keep.append(d)
    return keep


# What parse_with_meta reports alongside the file refs. Display-only catalog metadata;
# never required for backup/verify (those use parse_project). Keys always present.
def empty_meta() -> dict:
    return {"tempo": None, "tracks": None, "plugins": []}


class DawAdapter(Protocol):
    daw_id: str                      # 'ableton' | 'flstudio' — stored in catalog + manifest
    display_name: str                # 'Ableton Live'
    extensions: tuple[str, ...]      # ('.als',) — drives discovery AND parse dispatch
    backup_root: str                 # per-DAW destination subfolder ('AbletonBackups')

    def discover_projects(self, roots: list[Path]) -> Iterable[Path]: ...
    def parse_project(self, project_path: Path) -> list[FileRef]: ...
    def project_name(self, project_path: Path) -> str: ...
    def skip_dirs(self) -> set[str]: ...
    def default_libraries(self) -> list[Path]: ...

    # Scan-time only: refs PLUS display metadata (tempo/tracks/plugins) in one read, so
    # the scan doesn't parse each project twice. Adapters that don't override it get
    # refs + empty meta via parse_with_meta() below.
    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]: ...


def parse_with_meta(adapter: DawAdapter, project_path: Path) -> tuple[list[FileRef], dict]:
    """Call the adapter's own parse_with_meta if it has one, else fall back to plain
    refs + empty metadata. Lets adapters adopt metadata incrementally."""
    fn = getattr(adapter, "parse_with_meta", None)
    if fn is not None:
        return fn(project_path)
    return adapter.parse_project(project_path), empty_meta()


def walk_for_extensions(roots: list[Path], extensions: tuple[str, ...],
                        skip_dirs: set[str]) -> list[Path]:
    """Shared project-file discovery: one os.walk per root, matched by extension."""
    out: list[Path] = []
    exts = tuple(e.lower() for e in extensions)
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = _keep_dirs(dirnames, skip_dirs)
            for fn in filenames:
                if fn.lower().endswith(exts):
                    out.append(Path(dirpath) / fn)
    return out
