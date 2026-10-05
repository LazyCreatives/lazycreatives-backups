"""Studio One adapter (PreSonus Studio One, renamed Fender Studio Pro from version 8).

A ``Song.song`` file is a zip of XML, the same on Windows and Mac:

* ``Song/song.xml``: the arrangement. Its ``TempoMapSegment`` elements carry the
  tempo as *seconds per beat* (0.5 = 120 BPM); the ``Tracks`` list holds one element
  per track.
* ``Song/mediapool.xml``: every audio file the song uses, as
  ``<Url x:id="path" url="file:///…/Media/Vox.wav"/>``. Instrument parts point at
  ``media:///…`` members stored inside the zip itself; those ride along with the file.
* ``metainfo.xml``: ``<Attribute id="Document:Title" …/>`` and friends, including
  ``Media:KeySignature`` ("-" when no key is set).
* ``Devices/*.xml``: mixer and instrument racks; each plug-in slot holds a
  ``x:id="deviceData"`` element naming the plug-in.

Studio One keeps a song's recordings in the song folder's ``Media/`` and its exported
songs in ``Mixdown/``; ``History/`` holds autosaves and saved versions, which are
older copies of the same song, not songs of their own, so discovery leaves them out.

The XML uses an undeclared ``x:`` prefix (``x:id="…"``), which a strict parser
rejects, so it is renamed before parsing. Songs saved by Studio One 7 or later can't
be opened by older versions, but the file layout is unchanged, so every version reads
the same way here. No portable rewrite: Studio One stores full file addresses, and
when one is gone it finds the file again by name in the song folder, so a backup's
own ``Media/`` folder is picked up when the snapshot is opened.
"""
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse

import defusedxml.ElementTree as ET

from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.models import FileRef
from ablebackup.resolver import basename

# A received .song is attacker-supplyable (it's a zip): refuse decompression bombs.
_MAX_XML_BYTES = 64 * 1024 * 1024
_MAX_XML_RATIO = 200

_SONG_XML = "Song/song.xml"
_POOL_XML = "Song/mediapool.xml"
_META_XML = "metainfo.xml"

# Folder inside a song folder holding autosaves and saved versions of the same song.
_HISTORY_DIR = "history"
# Tracks that are part of the song's layout, not instruments or audio.
_LAYOUT_TRACKS = {"MarkerTrack", "ArrangerTrack", "ChordTrack", "SignatureTrack",
                  "TempoTrack", "FolderTrack", "VideoTrack"}


def is_history_copy(path) -> bool:
    """An autosave or saved version inside a song folder's History/ folder."""
    return Path(path).parent.name.lower() == _HISTORY_DIR


def _read_xml(z: zipfile.ZipFile, name: str):
    """The parsed member, or None when the song doesn't have it."""
    try:
        info = z.getinfo(name)
    except KeyError:
        return None
    if (info.file_size > _MAX_XML_BYTES
            or info.file_size / max(info.compress_size, 1) > _MAX_XML_RATIO):
        raise ValueError(f"{name} too large (possible zip bomb)")
    text = z.read(name).decode("utf-8-sig", errors="replace")
    # Studio One writes x:id="…" without declaring the x: prefix.
    text = re.sub(r"(\s)x:(\w+)=", r"\1x_\2=", text)
    return ET.fromstring(text)


def _open(song_path):
    """(song root, media pool root, metainfo root, [device roots]) of a .song."""
    try:
        with zipfile.ZipFile(song_path) as z:
            song = _read_xml(z, _SONG_XML)
            if song is None:
                raise ValueError("no Song/song.xml: not a Studio One song")
            pool = _read_xml(z, _POOL_XML)
            meta = _read_xml(z, _META_XML)
            devices = [_read_xml(z, n) for n in z.namelist()
                       if n.startswith("Devices/") and n.endswith(".xml")]
    except (zipfile.BadZipFile, ET.ParseError) as e:
        raise ValueError(f"could not read Studio One song: {e}") from e
    return song, pool, meta, [d for d in devices if d is not None]


def _url_to_path(url: str) -> str | None:
    """A file:// address as a plain path on whichever computer wrote it:
    file:///C:/Users/x/a.wav -> C:/Users/x/a.wav, file:///Users/x/a.wav ->
    /Users/x/a.wav, file://NAS/share/a.wav -> //NAS/share/a.wav."""
    if not url.lower().startswith("file:"):
        return None                       # media:/// lives inside the .song itself
    u = urlparse(url)
    path = unquote(u.path)
    if u.netloc and u.netloc.lower() != "localhost":
        return f"//{u.netloc}{path}"
    if re.match(r"^/[A-Za-z]:", path):
        path = path[1:]
    return path or None


def _media_paths(pool) -> list[str]:
    out: list[str] = []
    if pool is None:
        return out
    for el in pool.iter():
        if el.attrib.get("x_id") != "path":
            continue
        p = _url_to_path(el.attrib.get("url", ""))
        if p and p not in out:
            out.append(p)
    return out


def _to_ref(p: str, song_dir_name: str) -> FileRef:
    """A media file the song uses. When it sat in this song's own Media folder, also
    point at the same place relative to the .song, so a song folder moved to another
    drive or computer still finds its recordings (Studio One does the same)."""
    parts = [s for s in re.split(r"[\\/]+", p) if s]
    rel = None
    for i in range(len(parts) - 2, 0, -1):
        if parts[i].lower() == "media" and parts[i - 1] == song_dir_name:
            rel = "/".join(parts[i:])
            break
    return FileRef(name=basename(p), absolute_path=p, relative_path=rel, name_match=True)


def _tempo(song) -> float | None:
    for el in song.iter("TempoMapSegment"):
        try:
            spb = float(el.attrib.get("tempo", ""))
        except ValueError:
            continue
        if spb > 0:
            return round(60.0 / spb, 2)
    return None


def _track_count(song) -> int | None:
    for el in song.iter("List"):
        if el.attrib.get("x_id") == "Tracks":
            n = sum(1 for t in el if t.tag.endswith("Track") and t.tag not in _LAYOUT_TRACKS)
            return n or None
    return None


def _plugins(devices) -> list[str]:
    out: list[str] = []
    for root in devices:
        for el in root.iter():
            if el.attrib.get("x_id") == "deviceData":
                name = (el.attrib.get("name") or "").strip()
                if name and name not in out:
                    out.append(name)
    return out


def _meta_attrs(meta) -> dict:
    if meta is None:
        return {}
    return {el.attrib.get("id"): el.attrib.get("value") for el in meta.iter("Attribute")}


def read_tempo(song_path) -> float | None:
    """The song's starting tempo (used for a backed-up song's genre guess)."""
    try:
        return _tempo(_open(song_path)[0])
    except (OSError, ValueError):
        return None


class StudioOneAdapter:
    daw_id = "studioone"
    display_name = "Studio One"
    extensions = (".song",)
    backup_root = "StudioOneBackups"

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return [p for p in walk_for_extensions(roots, self.extensions, self.skip_dirs())
                if not self.ignore_file(p)]

    def ignore_file(self, path) -> bool:
        """Autosaves and saved versions are older copies of a song, not songs."""
        return is_history_copy(path)

    def parse_project(self, project_path: Path) -> list[FileRef]:
        _, pool, _, _ = _open(project_path)
        dir_name = Path(project_path).parent.name
        return [_to_ref(p, dir_name) for p in _media_paths(pool)]

    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]:
        song, pool, meta, devices = _open(project_path)
        dir_name = Path(project_path).parent.name
        attrs = _meta_attrs(meta)
        key = (attrs.get("Media:KeySignature") or "").strip()
        return [_to_ref(p, dir_name) for p in _media_paths(pool)], {
            "tempo": _tempo(song),
            "tracks": _track_count(song),
            "plugins": _plugins(devices),
            "key": key if key and key != "-" else None,
        }

    def project_name(self, project_path: Path) -> str:
        return project_path.stem

    def skip_dirs(self) -> set[str]:
        return set(COMMON_SKIP)

    def default_libraries(self) -> list[Path]:
        # Studio One's own sound sets live in its content folder; nothing shared to
        # search for moved samples.
        return []
