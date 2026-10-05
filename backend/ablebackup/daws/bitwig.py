"""Bitwig Studio adapter (native ``.bwproject`` files, Windows, Mac and Linux).

Bitwig saves each project in a folder of its own:

* ``Name.bwproject``: the project, a binary file starting ``BtWg`` and a version.
* ``samples/``, ``recordings/``, ``bounce/``, ``master-recordings/``,
  ``plugin-states/``: audio and plug-in data Bitwig made or collected for it.
* ``auto-backups/Name/Name [2019-08-14 200250].bwproject``: older copies Bitwig
  keeps while you work. Not projects of their own, so discovery leaves them out.
* ``.bitwig-project``: an empty marker file.

What can be read, checked against real projects saved by Bitwig 1.3 to 4.3:

* The file opens with a readable "meta" block of named fields. ``used_files`` lists
  every audio file the project uses, relative to the project folder (absolute when it
  lives elsewhere). ``referenced_packaged_file_ids`` are sounds from
  Bitwig's own installed packages; they come with Bitwig, so they are not backed up.
* The rest is a binary object list with numbered fields. The tempo is the one value
  read from it: the transport's ``tempo`` field (529) holds a tempo object (class
  1217) whose ``value`` field (712) is a double. Those numbers have not changed from
  Bitwig 1.3 to 4.3.
* Third-party plug-ins appear as the path of their plug-in file (``Serum.vst3``,
  ``Kontakt 5.dll``); their file names are the plug-in names shown.

Not readable: the project's key and track count (no field for either was found).
"""
import re
import struct
from pathlib import Path

from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.models import FileRef
from ablebackup.resolver import basename

_MAGIC = b"BtWg"
# Where the meta block starts: an object header named "meta".
_META_START = b"\x00\x00\x00\x04\x00\x00\x00\x04meta"
# A project's meta block is a few KB; anything this far in is not a meta block.
_META_LIMIT = 1024 * 1024

# Folder Bitwig keeps autosaved copies of a project in.
AUTO_BACKUPS = "auto-backups"
# Folders inside a project folder holding the project's own ingredients.
CONTENT_DIRS = ("samples", "recordings", "master-recordings", "bounce", "plugin-states")
_MARKER = ".bitwig-project"

# transport.tempo (field 529) -> tempo object (class 1217); its value is field 712.
_TEMPO_OBJ = b"\x00\x00\x02\x11\x09\x00\x00\x04\xc1"
_TEMPO_VALUE = b"\x00\x00\x02\xc8\x07"
_PLUGIN_FILE = re.compile(rb"\.(vst3|vst|dll|component|clap)(?![A-Za-z0-9])", re.I)


def is_auto_backup(path) -> bool:
    """An older copy in a project's auto-backups folder."""
    return any(part.lower() == AUTO_BACKUPS for part in Path(path).parent.parts)


def _u32(d: bytes, o: int) -> int:
    return int.from_bytes(d[o:o + 4], "big")


def _string(d: bytes, o: int) -> tuple[str, int]:
    n = _u32(d, o)
    o += 4
    if n & 0x80000000:                       # flagged length: UTF-16 text
        n &= 0x7FFFFFFF
        return d[o:o + 2 * n].decode("utf-16-be", errors="replace"), o + 2 * n
    return d[o:o + n].decode("utf-8", errors="replace"), o + n


def _value(d: bytes, o: int, kind: int):
    """One typed value of the meta block, and where the next one starts."""
    if kind == 0x01:
        return d[o], o + 1
    if kind == 0x02:
        return int.from_bytes(d[o:o + 2], "big", signed=True), o + 2
    if kind == 0x03:
        return int.from_bytes(d[o:o + 4], "big", signed=True), o + 4
    if kind == 0x05:
        return bool(d[o]), o + 1
    if kind == 0x06:
        return struct.unpack(">f", d[o:o + 4])[0], o + 4
    if kind == 0x07:
        return struct.unpack(">d", d[o:o + 8])[0], o + 8
    if kind == 0x08:
        return _string(d, o)
    if kind == 0x0D:                         # nested block: skipped whole
        return None, o + 4 + _u32(d, o)
    if kind == 0x15:                         # id
        return d[o:o + 16].hex(), o + 16
    if kind == 0x19:                         # list of text
        count, o = _u32(d, o), o + 4
        items = []
        for _ in range(count):
            n = _u32(d, o)
            items.append(d[o + 4:o + 4 + n].decode("utf-8", errors="replace"))
            o += 4 + n
        return items, o
    raise ValueError(f"unknown value type {kind}")


def read_meta(data: bytes) -> dict:
    """The named fields at the top of a .bwproject (what Bitwig shows in its project
    info panel, plus the files the project uses)."""
    start = data.find(_META_START, 0, _META_LIMIT)
    if start < 0:
        return {}
    o, out = start + len(_META_START), {}
    try:
        while o < len(data):
            kind = _u32(data, o)
            o += 4
            if kind == 0:                    # end of the block
                break
            if kind != 1:                    # anything but "named field": stop here
                break
            key, o = _string(data, o)
            value, o = _value(data, o + 1, data[o])
            if value is not None:
                out[key] = value
    except (IndexError, ValueError, struct.error):
        pass                                  # keep what was read before the damage
    return out


def read_tempo(data: bytes) -> float | None:
    i = data.find(_TEMPO_OBJ)
    if i < 0:
        return None
    j = data.find(_TEMPO_VALUE, i, i + 512)
    if j < 0:
        return None
    try:
        bpm = struct.unpack(">d", data[j + len(_TEMPO_VALUE):j + len(_TEMPO_VALUE) + 8])[0]
    except struct.error:
        return None
    return round(bpm, 2) if 10 <= bpm <= 999 else None


def _plugins(data: bytes) -> list[str]:
    """Names of third-party plug-ins, from the plug-in file paths the project keeps.
    Each is a length-prefixed text; the prefix is how the start of the path is found."""
    out: list[str] = []
    for m in _PLUGIN_FILE.finditer(data):
        end = m.end()
        for n in range(len(m.group(0)) + 1, min(end - 4, 1024) + 1):
            if _u32(data, end - n - 4) == n:
                text = data[end - n:end].decode("utf-8", errors="replace")
                name = re.split(r"[\\/]", text)[-1].rsplit(".", 1)[0].strip()
                if name and name not in out:
                    out.append(name)
                break
    return out


def _load(project_path) -> bytes:
    data = Path(project_path).read_bytes()
    if not data.startswith(_MAGIC):
        raise ValueError("not a Bitwig project (no BtWg header)")
    return data


def _is_absolute(p: str) -> bool:
    return p.startswith(("/", "\\\\", "//")) or bool(re.match(r"^[A-Za-z]:[\\/]", p))


def _refs(meta: dict, project_path: Path) -> list[FileRef]:
    folder = Path(project_path).parent
    refs: list[FileRef] = []
    seen: set[str] = set()

    def add(ref: FileRef):
        k = ref.absolute_path or ref.relative_path
        if k and k not in seen:
            seen.add(k)
            refs.append(ref)

    for p in meta.get("used_files") or []:
        if not isinstance(p, str) or not p.strip():
            continue
        p = p.strip()
        if _is_absolute(p):
            add(FileRef(name=basename(p), absolute_path=p, name_match=True))
        else:
            add(FileRef(name=basename(p), relative_path=p.replace("\\", "/")))
    # Plug-in states and the folder marker aren't listed as used files but belong to
    # the project; they ride along when present (never reported missing).
    states = folder / "plugin-states"
    if states.is_dir():
        for f in sorted(states.rglob("*")):
            if f.is_file() and not f.name.startswith("."):
                add(FileRef(name=f.name, relative_path=f.relative_to(folder).as_posix()))
    if (folder / _MARKER).is_file():
        add(FileRef(name=_MARKER, relative_path=_MARKER))
    return refs


def project_tempo(project_path) -> float | None:
    """The project's tempo (used for a backed-up project's genre guess)."""
    try:
        return read_tempo(_load(project_path))
    except (OSError, ValueError):
        return None


class BitwigAdapter:
    daw_id = "bitwig"
    display_name = "Bitwig Studio"
    extensions = (".bwproject",)
    backup_root = "BitwigBackups"

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return [p for p in walk_for_extensions(roots, self.extensions, self.skip_dirs())
                if not self.ignore_file(p)]

    def ignore_file(self, path) -> bool:
        """Autosaved copies are older versions of a project, not projects."""
        return is_auto_backup(path)

    def parse_project(self, project_path: Path) -> list[FileRef]:
        return _refs(read_meta(_load(project_path)), project_path)

    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]:
        data = _load(project_path)
        return _refs(read_meta(data), project_path), {
            "tempo": read_tempo(data),
            "tracks": None,
            "plugins": _plugins(data),
        }

    def project_name(self, project_path: Path) -> str:
        return Path(project_path).stem

    def skip_dirs(self) -> set[str]:
        return set(COMMON_SKIP) | {AUTO_BACKUPS}

    def default_libraries(self) -> list[Path]:
        return []
