"""Stems-only folders: a folder of stems with no project file from any music program.

Producers end up with these all the time: stems a collaborator sent, a remix contest
pack, a song whose project is long gone but whose parts were exported. Each such
folder is shown as a project of its own ("Stems only"), so it gets a Library tile,
its stems open on the Stems desk, and it is backed up like any project.

A folder counts when, without opening anything but file headers:

* it holds at least two sounds and no project file;
* it says it holds stems: it (or the folder it is in) is called "Stems" or
  "Multitracks", or at least half its sounds are named like parts ("Kick",
  "Night Drive - Vocals", Ableton's "Song 3-Bass", FL Studio's "Song_Insert 3");
* the parts line up: at least two are longer than 20 seconds and most of them are
  the same length, as stems exported together are. Sample packs (short one-shots)
  and folders of different songs never pass this;
* it isn't already part of a project: not inside a project's folder (where the
  project's own stems are found), not a samples or recordings folder, and not
  named after a project Backups already knows (those stems are that project's).

A folder called "Stems" whose sounds sit in sub-folders ("Drums/", "Vocals/") is
one stems folder, not one per sub-folder. Nothing is ever changed: the files are
only read.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from ablebackup.audiolen import seconds
from ablebackup.daws.base import COMMON_SKIP, _keep_dirs
from ablebackup.models import FileRef
from ablebackup.names import song_base
from ablebackup.stems import PARTS, SONG, is_stem, words

AUDIO_EXTS = (".wav", ".aiff", ".aif", ".aifc", ".flac", ".mp3", ".m4a", ".ogg", ".opus")
MIN_SOUNDS = 2
MAX_SOUNDS = 2000           # a folder with more than this is a library, not a song
LONG = 20.0                 # seconds: a stem of a song is longer than a one-shot
LENGTH_SLACK = (1.5, 0.03)  # seconds or share of the length: "the same length"
SAME_SHARE = 0.6            # this share of the long parts must be the same length
READ_AT_MOST = 40           # headers read per folder when deciding
# Folders that hold a project's ingredients or other people's sounds, never a song's
# stems: anywhere on the way to a folder, by exact name.
_NOT_STEMS = re.compile(
    r"^(samples?|sample[\s_-]?packs?|packs?|splice|one[\s_-]?shots?|loops?|drum[\s_-]?kits?|kits?"
    r"|cymatics|loopmasters|user library|recorded|processed|freeze|consolidate|imported"
    r"|sliced audio|audio files|media|peaks|recordings|master-recordings|plugin-states"
    r"|auto-backups|backup|backups|ableton project info|stemsbackups)$", re.I)
# A folder named for stems: "Stems", "Night Drive Stems", "STEMS_final", "Multitracks"
# (whole words only, so "Sound Systems" isn't one).
STEMS_NAME = re.compile(r"(?<![a-z])(stems?|multi[\s_-]?tracks?)(?![a-z])", re.I)
_BPM = re.compile(r"\b(\d{2,3})\s*bpm\b|\bbpm\s*(\d{2,3})\b", re.I)


def _audio(names) -> list[str]:
    return sorted(n for n in names if n.lower().endswith(AUDIO_EXTS) and not n.startswith((".", "~")))


def _tidy(s: str) -> str:
    s = re.sub(r"[\[(]\s*[\])]", " ", s)  # brackets left empty: "Night Drive ()"
    s = re.sub(r"[\s_-]+", " ", s).strip(" -_.")
    while s and s[-1] in ")]" and s.count("(") + s.count("[") < s.count(")") + s.count("]"):
        s = s[:-1].strip(" -_.")
    while s and s[-1] in "([":
        s = s[:-1].strip(" -_.")
    if s.count("(") > s.count(")"):
        s += ")"
    if s.count("[") > s.count("]"):
        s += "]"
    return s


def _generic(text: str) -> bool:
    """Only words like "audio", "final", "the": says nothing about which song.
    A name in another script ("夜の高速道路") is never generic."""
    ws = words(text)
    return bool(ws) and all(w in _GENERIC for w in ws) and not re.search(r"[^\x00-\x7f]", text)


def _common_lead(files: list[str]) -> str:
    """The words every part's name starts with: "Night Drive 1-Kick.wav" and
    "Night Drive 2-Bass.wav" -> "Night Drive"; "" when they share nothing useful."""
    if len(files) < 2:
        return ""
    split = [Path(f).stem.replace("_", " ").split() for f in files]
    common: list[str] = []
    for i, w in enumerate(split[0]):
        if all(len(s) > i + 1 and s[i].lower() == w.lower() for s in split[1:]):
            common.append(w)
        else:
            break
    lead = _tidy(re.sub(r"\s\d{1,3}$", "", " ".join(common)))
    if len(lead) < 3 or _generic(lead):
        return ""
    return lead


# Folders that say where things are kept, not which song: never a song's name.
_PLACE = re.compile(r"export|bounce|render|mixdown|master|desktop|downloads?|music|audio|wavs?|"
                    r"projects?|songs?|tracks?|new folder|untitled", re.I)


def song_name(folder: Path, files: list[str] = ()) -> str:
    """The song a stems folder is for: "Night Drive Stems" -> "Night Drive",
    "Night Drive/Stems" -> "Night Drive", "Stems/Night Drive" -> "Night Drive", and
    otherwise the words every part's name starts with ("Night Drive 1-Kick.wav",
    "Night Drive 2-Bass.wav"), or the folder's own name."""
    folder = Path(folder)
    if STEMS_NAME.search(folder.name):
        rest = _tidy(STEMS_NAME.sub(" ", folder.name))
        if len(rest) >= 1 and not _generic(rest):
            return rest
        up = next((u for u in folder.parents if u.name and not STEMS_NAME.search(u.name)), None)
        if up is not None and not _PLACE.fullmatch(up.name.strip()) and not _PLACE.match(up.name.strip()):
            return up.name
        return _common_lead(list(files)) or (up.name if up is not None else folder.name)
    if STEMS_NAME.search(folder.parent.name or ""):
        return folder.name
    return _common_lead(list(files)) or folder.name


_GENERIC = {"audio", "track", "stem", "stems", "untitled", "new", "song", "export", "final",
            "all", "the", "my"}


def bpm_from_names(folder: Path, files: list[str]) -> float | None:
    for text in [folder.name, *files]:
        m = _BPM.search(text)
        if m:
            v = float(m.group(1) or m.group(2))
            if 40 <= v <= 300:
                return v
    return None


def _blocked(folder: Path) -> bool:
    return any(_NOT_STEMS.match(part.strip()) for part in folder.parts)


def _named_like_stems(folder: Path, files: list[str], song: str) -> bool:
    if STEMS_NAME.search(folder.name) or STEMS_NAME.search(folder.parent.name or ""):
        return True
    parts = sum(1 for f in files if is_stem(Path(f), None, song))
    return parts >= MIN_SOUNDS and parts * 2 >= len(files)


def _lengths_line_up(paths: list[Path]) -> bool | None:
    """True when most long parts are the same length (stems exported together),
    False when they clearly aren't (one-shots, different songs), None when no
    length could be read (an M4A folder)."""
    lens: list[float] = []
    read = 0
    for p in paths[:READ_AT_MOST]:
        s = seconds(str(p))
        read += 1
        if s is not None:
            lens.append(s)
        if read >= 6 and lens and not any(x >= LONG for x in lens):
            return False  # all short so far: a sample pack
    if not lens:
        return None
    long = sorted(x for x in lens if x >= LONG)
    if len(long) < MIN_SOUNDS:
        return False
    best = 0
    for i, x in enumerate(long):
        slack = max(LENGTH_SLACK[0], x * LENGTH_SLACK[1])
        best = max(best, sum(1 for y in long[i:] if y - x <= slack))
    return best >= MIN_SOUNDS and best >= SAME_SHARE * len(long)


def looks_like_stems(folder: Path, files: list[Path]) -> bool:
    """Do these sounds (in ``folder`` and maybe one level below) look like one song's
    stems? Names first (cheap), then the lengths from the file headers."""
    if not (MIN_SOUNDS <= len(files) <= MAX_SOUNDS) or _blocked(folder):
        return False
    names = [f.name for f in files]
    if not _named_like_stems(folder, names, song_name(folder, names)):
        return False
    lined = _lengths_line_up(files)
    if lined is None:  # lengths unreadable: trust only a folder that says "Stems"
        return bool(STEMS_NAME.search(folder.name) or STEMS_NAME.search(folder.parent.name or ""))
    return lined


# Sub-folders a song's stems are sorted into: "Drums", "Vocals", "Music", "FX 2".
_GROUP_WORDS = PARTS | {"music", "instruments", "instrument", "other", "misc", "extras", "fx",
                        "drum", "beat", "beats", "melodic", "melodics", "harmony", "textures",
                        "and", "n", "dry", "wet", "wav", "wavs", "aiff", "24bit", "16bit"}


def _group_name(name: str) -> bool:
    ws = words(name)
    return bool(ws) and all(w in _GROUP_WORDS or w.isdigit() for w in ws)


# Words that make a sound the whole song ("Night Drive Master", "Instrumental").
_WHOLE = SONG | {"full", "fullmix", "stereo", "2track", "premaster"}


def full_mix(path: Path, song: str) -> bool:
    """Is this sound in a stems folder the whole song rather than one part? Its name
    is the song's ("Night Drive.wav"), or adds a whole-song word ("Night Drive
    Master", "Instrumental") and no part ("Vocal Mix" is a part)."""
    ws = words(Path(path).stem)
    rest = list(ws)
    for w in words(song):
        if w in rest:
            rest.remove(w)
    rest = [w for w in rest if not re.fullmatch(r"\d+(bpm)?|bpm|v\d*", w)]  # "124bpm", "v2"
    if any(w in PARTS for w in rest):
        return False
    return not rest or any(w in _WHOLE for w in rest)


def stem_files(folder: Path) -> list[Path]:
    """The sounds of a stems folder: those in it and in the folders directly in it
    ("Stems/Drums/Kick.wav"), in name order."""
    folder = Path(folder)
    out: list[Path] = []
    try:
        entries = sorted(os.scandir(folder), key=lambda e: e.name.lower())
    except OSError:
        return []
    for e in entries:
        if e.name.startswith((".", "~")):
            continue
        try:
            if e.is_file() and e.name.lower().endswith(AUDIO_EXTS):
                out.append(Path(e.path))
            elif e.is_dir(follow_symlinks=False) and not _NOT_STEMS.match(e.name):
                try:
                    out.extend(Path(e.path) / n for n in _audio(os.listdir(e.path)))
                except OSError:
                    pass
        except OSError:
            continue
    return out[:MAX_SOUNDS]


class StemFolderFinder:
    """Collects folders of sounds during a walk (``visit`` per folder, in os.walk
    order) and picks the stems folders at the end (``finish``), once every project
    file under the same roots is known."""

    def __init__(self):
        self._audio: dict[str, list[str]] = {}   # folder -> its sound files
        self._projects: dict[str, int] = {}      # folder -> project files in it
        self._songs: dict[str, set[str]] = {}    # folder -> the songs its project files are saves of

    def visit(self, dirpath: str, filenames: list[str], project_count: int) -> None:
        if project_count:
            self._projects[dirpath] = self._projects.get(dirpath, 0) + project_count
        audio = _audio(filenames)
        if audio:
            self._audio[dirpath] = audio[:MAX_SOUNDS + 1]

    def finish(self, projects: list[Path], project_name=lambda p: Path(p).stem) -> list[Path]:
        from ablebackup.exports import normalize  # here: exports is heavy and imports nothing of ours
        for p in projects:  # folder projects (Logic packages) count where they sit
            d = str(Path(p).parent)
            if Path(p).is_dir():
                self._projects[d] = self._projects.get(d, 0) + 1
        known = {normalize(project_name(p)) for p in projects} - {""}
        for p in projects:
            self._songs.setdefault(str(Path(p).parent), set()).add(normalize(song_base(Path(p).stem)))
        children: dict[str, list[str]] = {}
        for k in self._audio:
            children.setdefault(str(Path(k).parent), []).append(k)
        # A "Stems" folder can hold its sounds in sub-folders ("Stems/Drums", "Stems/Vocals").
        cands = set(self._audio) | {d for d in children if STEMS_NAME.search(Path(d).name)}
        out: list[Path] = []
        taken: set[str] = set()
        # Shallowest first, so a "Stems" folder claims its "Drums/" and "Vocals/".
        for d in sorted(cands, key=lambda s: (s.count(os.sep), s)):
            folder = Path(d)
            if d in taken or self._projects.get(d) or self._inside_project(d) \
                    or any(str(a) in taken for a in folder.parents):
                continue
            files = [folder / n for n in self._audio.get(d, [])]
            subs = sorted(children.get(d, [])) if STEMS_NAME.search(folder.name) else []
            subs = [k for k in subs if not self._projects.get(k) and not _NOT_STEMS.match(Path(k).name)]
            if not all(_group_name(Path(k).name) for k in subs):
                subs = []  # "Stems/Night Drive", "Stems/Sunrise": a folder of songs' stems
            files += [Path(k) / n for k in subs for n in self._audio[k]]
            if not looks_like_stems(folder, files):
                continue
            if normalize(song_name(folder, [f.name for f in files])) in known:
                continue  # named after a project: they're that project's stems
            out.append(folder)
            taken.add(d)
            taken.update(subs)
        return sorted(out)

    def _inside_project(self, d: str) -> bool:
        """In (or up to two folders below) a folder that holds one project, or several
        saves of one song ("Night Drive.als", "Night Drive v2.als"): that project's own
        folder, whose stems Backups already finds as its exports."""
        p = Path(d)
        for up in (p, p.parent, p.parent.parent):
            n = self._projects.get(str(up), 0)
            if n == 1 or (n > 1 and len(self._songs.get(str(up), ())) == 1):
                return True
        return False


def discover_stem_folders(roots: list[Path], project_exts: tuple[str, ...],
                          package_exts: tuple[str, ...], skip_dirs: set[str],
                          projects: list[Path]) -> list[Path]:
    """Every stems folder under the roots, in one walk (for callers that didn't
    collect them during their own walk)."""
    finder = StemFolderFinder()
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            pkgs = [d for d in dirnames if d.lower().endswith(package_exts)] if package_exts else []
            dirnames[:] = _keep_dirs([d for d in dirnames if d not in pkgs], skip_dirs)
            finder.visit(dirpath, filenames, sum(1 for f in filenames if f.lower().endswith(project_exts)))
    return finder.finish(projects)


class StemFolderAdapter:
    daw_id = "stems"
    display_name = "Stems only"
    extensions: tuple[str, ...] = ()  # a folder with no project file: never matched by type
    backup_root = "StemsBackups"
    # The folder itself is the project's folder: its sounds are the project's files.
    folder_is_project_dir = True

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        from ablebackup.daws.registry import DAW_REGISTRY, package_extensions
        others = [a for a in DAW_REGISTRY if a is not self]
        projects = [p for a in others for p in a.discover_projects(roots)]
        exts = tuple(e.lower() for a in others for e in a.extensions)
        skip = set().union(*(a.skip_dirs() for a in DAW_REGISTRY))
        return discover_stem_folders(roots, exts, package_extensions(), skip, projects)

    def parse_project(self, project_path: Path) -> list[FileRef]:
        return self.parse_with_meta(project_path)[0]

    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]:
        folder = Path(project_path)
        if not folder.is_dir():
            raise ValueError(f"not a folder: {folder}")
        files = stem_files(folder)
        if not files:
            raise ValueError("no sounds in this stems folder")
        refs = [FileRef(name=f.name, relative_path=f.relative_to(folder).as_posix(),
                        size=_size(f)) for f in files]
        names = [f.name for f in files]
        song = song_name(folder, names)
        meta = {"tempo": bpm_from_names(folder, names),
                # the stems, not counting a full mix kept with them
                "tracks": sum(1 for f in files if not full_mix(f, song)) or len(files), "plugins": []}
        return refs, meta

    def project_name(self, project_path: Path) -> str:
        folder = Path(project_path)
        return song_name(folder, [f.name for f in stem_files(folder)[:40]])

    def skip_dirs(self) -> set[str]:
        return set(COMMON_SKIP) | {self.backup_root}

    def default_libraries(self) -> list[Path]:
        return []


def _size(p: Path) -> int:
    try:
        return p.stat().st_size
    except OSError:
        return 0
