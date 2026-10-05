"""Logic Pro adapter (Mac only).

A Logic project is a macOS *package*: a folder that Finder shows as one file.

* ``Song.logicx`` (Logic Pro X / 10+ / 11): ``Alternatives/000/ProjectData`` (binary
  song data) plus ``MetaData.plist`` (tempo, key, track count and the audio files the
  project uses), one numbered folder per alternative, ``Resources/`` and, when the
  user chose "copy audio into project", ``Media/Audio Files/`` and friends.
* ``Song.logic`` (Logic 8/9): an older package with the same idea and no metadata
  file we rely on.

A whole package is ONE project: discovery stops at the package and never walks into
it (it can hold thousands of files). Every file inside it is backed up keeping its
layout (like Audacity's ``_data`` folder), so the snapshot holds a package Logic can
open. Regenerable caches Logic marks ``.nosync`` (undo history, freeze files) are
left out. Audio the project uses from OUTSIDE the package (a project saved as a
folder with ``Audio Files/`` next to it, or files referenced in place) is gathered
from ``MetaData.plist`` like any other DAW's external samples; anything it lists that
is gone is reported missing. The binary ProjectData is never parsed, so plugin names
are not known; tempo, key and track count come from the plist.
"""
import os
import plistlib
from pathlib import Path

from ablebackup.daws.base import COMMON_SKIP, _keep_dirs
from ablebackup.models import FileRef

PACKAGE_EXTS = (".logicx", ".logic")

# Folders inside a package that Logic rebuilds itself and that can be very large.
_REGENERABLE_SUFFIX = ".nosync"
_JUNK_FILES = {".DS_Store"}

# MetaData.plist arrays listing audio the project uses. AudioFiles is the project's
# own audio: a listed file that is gone is a real hole, so it is reported missing.
# The rest are instrument content (sampler zones, impulse responses, …) that often
# points at Apple's or a library's factory content; those ride along when present
# and are never reported missing.
_OWN_AUDIO_KEY = "AudioFiles"
_OTHER_AUDIO_KEYS = ("SamplerInstrumentsFiles", "UltrabeatFiles", "ImpulsResponsesFiles",
                     "QuicksamplerFiles", "AlchemyFiles", "PlaybackFiles")


def is_package(name: str) -> bool:
    return name.lower().endswith(PACKAGE_EXTS)


def _alternatives(pkg: Path) -> list[Path]:
    alt_root = pkg / "Alternatives"
    try:
        return [d for d in alt_root.iterdir() if d.is_dir()]
    except OSError:
        return []


def _current_alternative(pkg: Path) -> Path | None:
    """The alternative saved most recently (its ProjectData is newest): the one Logic
    opens by default and the one whose tempo and key we show."""
    best, best_t = None, -1.0
    for alt in _alternatives(pkg):
        data = alt / "ProjectData"
        try:
            t = data.stat().st_mtime
        except OSError:
            continue
        if t > best_t:
            best, best_t = alt, t
    return best


def _read_plist(path: Path) -> dict:
    try:
        with open(path, "rb") as fh:
            data = plistlib.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, plistlib.InvalidFileException, ValueError, TypeError):
        return {}


def _package_files(pkg: Path) -> list[Path]:
    """Every file inside the package, minus Logic's own rebuildable caches."""
    out: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(pkg):
        dirnames[:] = [d for d in dirnames if not d.endswith(_REGENERABLE_SUFFIX)]
        for fn in filenames:
            if fn not in _JUNK_FILES:
                out.append(Path(dirpath) / fn)
    return out


def _inside(p: Path, folder: Path) -> bool:
    try:
        p.resolve().relative_to(folder.resolve())
        return True
    except (ValueError, OSError):
        return False


def _audio_ref(entry: str, pkg: Path, report_missing: bool) -> FileRef | None:
    """A ref for one plist audio entry, or None when it is already inside the package
    (backed up with it) or is optional content that isn't there."""
    entry = (entry or "").strip()
    if not entry:
        return None
    name = Path(entry.replace("\\", "/")).name
    if os.path.isabs(entry):
        p = Path(entry)
        if p.is_file() and _inside(p, pkg):
            return None
        if not report_missing and not p.is_file():
            return None
        return FileRef(name=name, absolute_path=entry)
    # Relative entries are written against the package's media folder, the package
    # itself, or (for projects saved as a folder) the folder the package sits in.
    rel = entry.lstrip("./")
    for cand in (pkg / "Media" / rel, pkg / rel, pkg.parent / rel):
        if cand.is_file():
            if _inside(cand, pkg):
                return None
            return FileRef(name=name, relative_path=str(cand.relative_to(pkg.parent)))
    if not report_missing:
        return None
    expected = f"{pkg.name}/Media/{rel}" if (pkg / "Media").is_dir() else rel
    return FileRef(name=name, relative_path=expected)


def _key_name(meta: dict) -> str | None:
    key = meta.get("SongKey")
    if not isinstance(key, str) or not key.strip():
        return None
    mode = meta.get("SongGenderKey")
    return f"{key.strip()} {mode.strip()}" if isinstance(mode, str) and mode.strip() else key.strip()


def read_package(pkg: Path) -> tuple[list[FileRef], dict]:
    """Refs (every file in the package + outside audio) and display metadata."""
    pkg = Path(pkg)
    if not pkg.is_dir():
        raise ValueError(f"not a Logic project package: {pkg}")
    alt = None
    if pkg.suffix.lower() == ".logicx":
        alt = _current_alternative(pkg)
        if alt is None:
            raise ValueError("not a Logic project (no Alternatives/*/ProjectData)")
    files = _package_files(pkg)
    if not files:
        raise ValueError("empty Logic project package")

    refs: list[FileRef] = []
    seen: set[str] = set()
    for f in files:
        rel = f.relative_to(pkg.parent).as_posix()
        seen.add(rel)
        refs.append(FileRef(name=f.name, relative_path=rel))

    meta_plist = _read_plist(alt / "MetaData.plist") if alt is not None else {}
    for key in (_OWN_AUDIO_KEY, *_OTHER_AUDIO_KEYS):
        entries = meta_plist.get(key)
        if not isinstance(entries, list):
            continue
        for e in entries:
            if not isinstance(e, str):
                continue
            ref = _audio_ref(e, pkg, report_missing=(key == _OWN_AUDIO_KEY))
            if ref is None:
                continue
            k = ref.absolute_path or ref.relative_path
            if k in seen:
                continue
            seen.add(k)
            refs.append(ref)

    tempo = meta_plist.get("BeatsPerMinute")
    tracks = meta_plist.get("NumberOfTracks")
    meta = {
        "tempo": float(tempo) if isinstance(tempo, (int, float)) and tempo > 0 else None,
        "tracks": int(tracks) if isinstance(tracks, int) and tracks > 0 else None,
        "plugins": [],
        "key": _key_name(meta_plist),
    }
    return refs, meta


def discover_packages(roots: list[Path], skip_dirs: set[str]) -> list[Path]:
    """Every Logic package under the roots. Stops at each package (never walks in)."""
    out: list[Path] = []
    for root in roots:
        for dirpath, dirnames, _ in os.walk(root):
            pkgs = [d for d in dirnames if is_package(d)]
            out.extend(Path(dirpath) / d for d in pkgs)
            dirnames[:] = _keep_dirs([d for d in dirnames if not is_package(d)], skip_dirs)
    return out


class LogicAdapter:
    daw_id = "logic"
    display_name = "Logic Pro"
    extensions = PACKAGE_EXTS
    # Projects are folders (macOS packages), not files: discovery matches folder names.
    package_extensions = PACKAGE_EXTS
    backup_root = "LogicBackups"

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return discover_packages(roots, self.skip_dirs())

    def parse_project(self, project_path: Path) -> list[FileRef]:
        return read_package(project_path)[0]

    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]:
        return read_package(project_path)

    def project_name(self, project_path: Path) -> str:
        return Path(project_path).stem

    def skip_dirs(self) -> set[str]:
        return set(COMMON_SKIP)

    def default_libraries(self) -> list[Path]:
        return []
