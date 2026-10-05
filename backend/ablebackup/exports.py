"""Song exports (bounces/renders) linked to the projects they came from, plus a
read-only bridge to the sibling **Uploader** app's history.

Neither Ableton nor FL Studio stamps the project name inside an exported audio
file, so a render is matched to its project from where it lives and what it's
called, most confident first:

  1. ``folder``: the file sits in the project's own folder (or a non-sample
     subfolder), and that folder holds only this one project. Ableton and FL
     both default their export dialog to the project folder.
  2. ``name``: the file is in a shared exports folder (the user's own list, or
     Uploader's watch folders) or a folder several projects share, and its
     normalized name equals, or starts with, exactly one project's name
     ("Night Drive final v2.wav", "Night Drive - club edit.wav" -> "Night Drive").
     Same-named projects are told apart by which was saved closest to the export.
  3. ``manual``: the user linked it. Manual links and "not from this project"
     dismissals (``hidden``) survive every refresh and always win.

The Uploader catalog is opened **read-only** and never written; if Uploader isn't
installed everything here quietly returns nothing.
"""
import json
import os
import re
import sqlite3
import threading
import time
from pathlib import Path

from . import audiotags
from .songmatch import (GENERIC, close_spelling, is_stem, minutes_text, name_variants,
                        nearest, reaper_render, snapshot_time, squash, stem_folder_name)

AUDIO_EXTS = {".wav", ".aiff", ".aif", ".aifc", ".flac", ".mp3", ".aac", ".m4a", ".ogg", ".wma",
              ".opus"}
_RENDER_EXTS = ("wav", "aifc", "aiff", "aif", "mp3", "flac", "m4a", "ogg", "wma", "aac", "opus")

# Subfolders of a project folder that hold *ingredients*, not finished songs:
# Ableton's recorded/frozen/consolidated audio, backups, FL's sliced/recorded audio.
# A "Stems" folder is looked in: its files are listed as the song's stems.
_SKIP_DIRS = {"samples", "backup", "backups", "ableton project info", "recorded",
              "processed", "freeze", "consolidate", "imported", "sliced audio",
              "audio files", "media", "peaks"}
_MAX_DEPTH = 2  # project root + one or two levels (e.g. "Exports/2026")
# Logic Pro project packages: a folder Finder shows as one file, holding the project's
# own recordings. Never a place finished songs are saved.
_PACKAGE_SUFFIXES = (".logicx", ".logic")
# A Bitwig project folder keeps the project's own recordings and bounced clips in
# these; only skipped inside a Bitwig project folder, since "Bounce" is also a common
# name for a folder of finished songs.
_BITWIG_SKIP_DIRS = {"recordings", "master-recordings", "bounce", "plugin-states",
                     "auto-backups"}


def _is_bitwig_folder(d: Path) -> bool:
    try:
        return (d / ".bitwig-project").is_file() or any(d.glob("*.bwproject"))
    except OSError:
        return False


# Dates, tempos and keys people put in render names: "2026-10-01 Night Drive",
# "Night Drive 07.10.26", "Night Drive 124bpm Amin", "Sunset (128 BPM) F#m".
_DATES = re.compile(r"\b(?:19|20)\d\d[-_. ]?[01]\d[-_. ]?[0-3]\d\b"
                    r"|\b[0-3]?\d[-_.][01]?\d[-_.](?:19|20)?\d\d\b")
_KEY = r"[a-g](?:#|b|sharp|flat)?\s?(?:maj(?:or)?|min(?:or)?|m)?"
_TEMPO = re.compile(rf"\b\d{{2,3}}\s*bpm\b(?:[\s_-]*{_KEY}\b)?|\bbpm\s*\d{{2,3}}\b"
                    r"|\b[a-g](?:#|b)?\s?(?:maj(?:or)?|min(?:or)?)\s*$|\s[a-g](?:#|b)m\s*$")


def _undecorate(s: str) -> str:
    s = re.sub(rf"\.({'|'.join(_RENDER_EXTS)})$", "", s).replace("_", " ")
    s = re.sub(r"\(autosaved[^)]*\)", " ", s)
    s = _DATES.sub(" ", s)
    s = re.sub(r"[\[(]\s*\d{1,4}\s*(bpm)?\s*[\])]", " ", s)
    s = _TEMPO.sub(" ", s)
    return _TEMPO.sub(" ", s.strip())


def normalize(name: str) -> str:
    """Reduce a render filename or project name to a comparable key.

    Kept identical to Uploader's ``projectmeta.normalize`` so both apps agree on
    which project a song belongs to."""
    s = _undecorate((name or "").lower().strip())
    s = re.sub(r"[\s_-]+(v?\d+|master(ed)?|final|mix(down)?|render|bounce|export|wip|draft)\b",
               " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def normalize_keep_numbers(name: str) -> str:
    """Like :func:`normalize` but keeps a bare number that is part of the title, so
    "Freaky 3 master.wav" stays "freaky 3" and finds the project "Freaky 3" even when
    "Freaky", "Freaky 2" and "Freaky 3" all exist. Version tags ("v2") still go, and
    "Freaky_02" reads as "freaky 2"."""
    s = _undecorate((name or "").lower().strip())
    s = re.sub(r"[\s_-]+(v\d+|master(ed)?|final|mix(down)?|render|bounce|export|wip|draft)\b",
               " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = re.sub(r"\b0+(\d)", r"\1", s)
    return s


# ---- Uploader bridge (read-only) ---------------------------------------------
def _candidate_uploader_dbs() -> list[Path]:
    out: list[Path] = []
    env = os.environ.get("ABLEBACKUP_UPLOADER_DB")
    if env:
        out.append(Path(env))
        return out  # an explicit override is authoritative (tests, demos)
    home = Path.home()
    out.append(home / "Library/Application Support/LazyCreatives Uploader/catalog.db")
    appdata = os.environ.get("APPDATA")
    local = os.environ.get("LOCALAPPDATA")
    if appdata:
        out.append(Path(appdata) / "LazyCreatives Uploader" / "catalog.db")
    if local:
        out.append(Path(local) / "lazyupload" / "catalog.db")
    out.append(home / ".config/LazyCreatives Uploader/catalog.db")
    return out


def find_uploader_db() -> Path | None:
    for p in _candidate_uploader_dbs():
        try:
            if p.is_file():
                return p
        except OSError:
            continue
    return None


def _ro_connect(db: Path):
    # mode=ro: never write. Not immutable — Uploader may be writing while we read.
    return sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)


def uploader_sources() -> list[Path]:
    """Uploader's watch folders (where people drop finished mixes)."""
    db = find_uploader_db()
    if not db:
        return []
    try:
        con = _ro_connect(db)
        try:
            row = con.execute("SELECT value FROM settings WHERE key = 'config'").fetchone()
        finally:
            con.close()
        cfg = json.loads(row[0]) if row else {}
        return [Path(s) for s in (cfg.get("sources") or []) if s]
    except (sqlite3.Error, ValueError, TypeError):
        return []


def uploader_uploads() -> list[dict]:
    """Every successful SoundCloud upload Uploader has recorded, newest first."""
    db = find_uploader_db()
    if not db:
        return []
    try:
        con = _ro_connect(db)
        con.row_factory = sqlite3.Row
        try:
            cols = {r["name"] for r in con.execute("PRAGMA table_info(uploads)")}
            pid = "backups_project_id" if "backups_project_id" in cols else "NULL"
            rows = con.execute(
                f"SELECT title, file_path, permalink_url, timestamp, {pid} AS project_id "
                "FROM uploads WHERE status = 'uploaded' ORDER BY timestamp DESC, id DESC"
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return []
    return [dict(r) for r in rows]


# ---- discovery ----------------------------------------------------------------
def _audio_files(root: Path, max_depth: int, skip_samples: bool,
                 deadline: float | None = None) -> list[Path]:
    out: list[Path] = []
    skip = _SKIP_DIRS | _BITWIG_SKIP_DIRS if skip_samples and _is_bitwig_folder(root) \
        else _SKIP_DIRS

    def walk(d: Path, depth: int):
        if deadline is not None and time.monotonic() > deadline:
            return  # out of time: keep what we have
        try:
            entries = list(os.scandir(d))
        except OSError:
            return
        for e in entries:
            name = e.name
            if name.startswith((".", "~")):
                continue
            try:
                if e.is_dir(follow_symlinks=False):
                    if name.lower().endswith(_PACKAGE_SUFFIXES):
                        continue
                    if depth < max_depth and not (skip_samples and name.lower() in skip):
                        walk(Path(e.path), depth + 1)
                elif e.is_file() and Path(name).suffix.lower() in AUDIO_EXTS:
                    out.append(Path(e.path))
            except OSError:
                continue

    if root.is_dir():
        walk(root, 0)
    return out


_REACH_TIMEOUT = 3.0  # seconds to wait for a folder to answer before skipping it


def _mount_key(p: str) -> str:
    """The drive a path is on, so one unplugged drive or sleeping network share is
    tried once, not once per project on it: "/Volumes/NAS/a/b" gives "/Volumes/NAS",
    a Windows path gives its drive or share, anything else gives the path itself."""
    parts = Path(p).parts
    if len(parts) >= 3 and parts[1] in ("Volumes", "mnt", "media", "run"):
        return str(Path(*parts[:3]))
    return parts[0] if parts and parts[0] not in ("/", "") else p


class _Reach:
    """Answers "is this folder there?" without ever hanging: a disconnected network
    share can make a plain folder check wait for minutes. Each check runs in a
    helper thread and counts as "not there" if it takes longer than a few seconds;
    the answer is remembered per drive."""

    def __init__(self, timeout: float = _REACH_TIMEOUT):
        self.timeout = timeout
        self.dead: set[str] = set()

    def ok(self, path) -> bool:
        p = str(path)
        key = _mount_key(p)
        if key in self.dead:
            return False
        box: list[bool] = []
        t = threading.Thread(target=lambda: box.append(os.path.isdir(p)), daemon=True)
        t.start()
        t.join(self.timeout)
        if not box:  # didn't answer in time: treat the whole drive as away for this run
            self.dead.add(key)
            return False
        return box[0]


def _resolve(p: Path) -> str:
    try:
        return str(p.resolve())
    except OSError:
        return str(p)


_TIME_WINDOW = 24 * 3600  # an export is usually made within a day of the last save
_CLOSE_WINDOW = 3 * 3600  # a misspelt name counts only if exported this close to a save
_DATE_WINDOW = 2 * 3600   # "probably from X": exported this close to X's save


def _project_names(p: dict) -> list[tuple[str, str]]:
    """What a song from this project is likely called, each with where the name
    comes from: the project's own name, and the name of its folder ("Freaky Project"
    -> "Freaky") when that folder holds just this one project, since people often
    name the export after the folder."""
    names = [(p.get("name") or "", "name")]
    folder = p.get("_folder_name")
    if folder:
        names.append((re.sub(r"\s+project$", "", folder.strip(), flags=re.I), "folder"))
    return names


# Which kind of name wins when two projects share a key: one you taught it by hand,
# then a project's real name, then a name it had before being renamed.
_SOURCE_RANK = {"learned": 0, "render": 1, "name": 1, "folder": 1, "old": 2}


class _NameIndex:
    """Normalized project names -> projects, for matching a render's file name.

    Tried in order, first hit wins:
      1. the name with its numbers kept ("Freaky 3 master" -> project "Freaky 3"),
         exact, then the longest project name it starts with;
      2. the looser name with trailing numbers dropped ("Night Drive final v2" ->
         "night drive"), exact, then the longest project name it starts with;
      3. the same again with an artist name or track number in front dropped
         ("Robert - Night Drive", "01 Night Drive");
      4. the name with its spaces ignored ("NightDrive").
    "Starts with" is on a word boundary ("Night Drive - club edit" -> "Night Drive").
    Besides each project's own name it knows names it had before a rename and names
    of songs you linked by hand (``aliases``), and uses every known save time of a
    project (``saves``) to tell same-named projects apart.

    A hit is {"project_id", "why", "sure"}: why is plain words for the clue, and
    sure is False for anything looser than the plain name (shown as "guessed")."""

    def __init__(self, projects: list[dict], aliases: dict | None = None,
                 saves: dict | None = None):
        self.saves = saves or {}
        self.projects = projects
        self.tiers: list[tuple[callable, dict[str, list[tuple]], list[str]]] = []
        for fn in (normalize_keep_numbers, normalize):
            by_key: dict[str, list[tuple]] = {}
            for p in projects:
                names = _project_names(p) + list((aliases or {}).get(p["project_id"], []))
                seen: set[str] = set()
                for n, src in names:
                    k = fn(n)
                    if len(k) < 3 or k in seen:  # 1-2 character names are too loose
                        continue
                    seen.add(k)
                    by_key.setdefault(k, []).append((p, src, n))
            self.tiers.append((fn, by_key, sorted(by_key, key=len, reverse=True)))
        loose = self.tiers[1][1]
        self.squashed: dict[str, list[tuple]] = {}
        for k, cands in loose.items():
            if len(squash(k)) >= 5:
                self.squashed.setdefault(squash(k), []).extend(cands)

    # -- picking one project out of several with the same name --
    def save_times(self, p: dict) -> list[float]:
        return [t for t in [p.get("mtime")] + list(self.saves.get(p["project_id"], [])) if t]

    def _pick(self, cands: list[tuple], f_mtime: float | None) -> tuple | None:
        best = min(_SOURCE_RANK.get(c[1], 1) for c in cands)
        cands = [c for c in cands if _SOURCE_RANK.get(c[1], 1) == best]
        by_id = {c[0]["project_id"]: c for c in cands}
        if len(by_id) == 1:
            return next(iter(by_id.values()))
        if f_mtime is None:
            return None
        timed = sorted((nearest(self.save_times(c[0]), f_mtime) or float("inf"), pid)
                       for pid, c in by_id.items())
        if timed[0][0] > _TIME_WINDOW:
            return None
        if len(timed) > 1 and timed[1][0] <= _TIME_WINDOW:
            return None  # two plausible projects saved around then: don't guess
        return by_id[timed[0][1]]

    @staticmethod
    def _hit(c: tuple, exact: bool, plain: bool) -> dict:
        p, src, name = c
        if src == "render" and plain:
            why, sure = "named the way this Reaper project names its renders", exact
        elif src == "learned":
            why, sure = "named like a song you added to this project", False
        elif src == "old":
            why, sure = f"matches this project's old name, “{name}”", False
        elif not plain:
            why, sure = "the name matches once the part in front of it is left out", False
        elif not exact:
            why, sure = "the name starts with this project's name", False
        else:
            why, sure = "name matches this project", True
        return {"project_id": p["project_id"], "why": why, "sure": sure}

    def _lookup(self, text: str, f_mtime: float | None, plain: bool) -> dict | None:
        for fn, by_key, keys in self.tiers:
            k = fn(text)
            if not k:
                continue
            if k in by_key:
                c = self._pick(by_key[k], f_mtime)
                if c:
                    return self._hit(c, True, plain)
                continue  # this name is shared and can't be told apart: try the looser key
            for key in keys:  # longest first
                if k.startswith(key + " "):
                    c = self._pick(by_key[key], f_mtime)
                    if c:
                        # "Night Drive master 2": a number after the name, but the
                        # plain name is an exact match once the number goes too
                        loose = self.tiers[1][1].get(normalize(text), [])
                        exact = any(x[0]["project_id"] == c[0]["project_id"] for x in loose)
                        return self._hit(c, exact, plain)
                    break
        return None

    def match(self, stem: str, f_mtime: float | None) -> dict | None:
        for i, text in enumerate([stem] + name_variants(stem)):
            hit = self._lookup(text, f_mtime, plain=i == 0)
            if hit:
                return hit
        words = normalize(stem).split()
        for j in range(len(words), 0, -1):  # the whole name, then fewer words
            c = self.squashed.get("".join(words[:j]))
            if c:
                c = self._pick(c, f_mtime)
                if c:
                    return {"project_id": c[0]["project_id"], "sure": False,
                            "why": "the name matches with the spaces left out"}
                break
        return None

    def close(self, stem: str) -> list[dict]:
        """Projects whose name is spelled almost like the render's ("Nite Drive")."""
        k = normalize(stem)
        words = k.split()
        out: dict[str, dict] = {}
        for key, cands in self.tiers[1][1].items():
            n = len(key.split())
            for cand in {k, " ".join(words[:n])}:
                if close_spelling(cand, key):
                    for p, _src, _n in cands:
                        out[p["project_id"]] = p
        return list(out.values())

    def by_time(self, f_mtime: float | None, window: float,
                exclude: set[str] = frozenset()) -> tuple[dict, float] | None:
        """The one project saved closest to when the render was made, if it was
        within ``window`` and clearly closer than any other."""
        if f_mtime is None:
            return None
        timed = sorted(((nearest(self.save_times(p), f_mtime), p) for p in self.projects
                        if p["project_id"] not in exclude), key=lambda x: x[0] or float("inf"))
        timed = [(d, p) for d, p in timed if d is not None and d <= window]
        if not timed:
            return None
        if len(timed) > 1 and timed[1][0] < 2 * timed[0][0] + 600:
            return None  # several projects saved around then
        return timed[0][1], timed[0][0]


def _mtime(f: Path) -> float | None:
    try:
        return f.stat().st_mtime
    except OSError:
        return None


def _when_text(p: dict, f_mtime: float, saves: list[float]) -> str:
    d = min(saves, key=lambda t: abs(t - f_mtime))
    gap = minutes_text(abs(f_mtime - d))
    return f"exported {gap} after this project was saved" if f_mtime >= d \
        else f"exported {gap} before this project was saved"


def match_exports(projects: list[dict], extra_dirs: list[Path] | None = None,
                  deadline: float | None = None, reach: "_Reach | None" = None,
                  hints: dict | None = None, unmatched: list | None = None) -> list[dict]:
    """Find audio exports for the given projects (rows with project_id/name/dir).

    Returns one row per (path, project_id): path, project_id, name, size, mtime,
    match ('folder' | 'name'), kind ('song' | 'stem'), why (plain words for the
    clue) and sure (False when it's a guess). Pure filesystem; the caller persists
    it. Folders that don't answer quickly (unplugged drive, sleeping network share)
    are skipped, and once ``deadline`` (a ``time.monotonic()`` value) passes it
    stops looking and returns what it found.

    ``hints`` carries what the catalog knows beyond the projects themselves:
    ``aliases`` {project_id: [(name, "old" | "learned")]}, ``saves`` {project_id:
    [save times]} and ``blocked`` {(normalized song name, project_id)} for songs the
    user said aren't from a project. Songs in exports folders that match no project
    are appended to ``unmatched`` with a suggested project when one is likely."""
    reach = reach or _Reach()
    hints = hints or {}
    aliases, saves = hints.get("aliases") or {}, hints.get("saves") or {}
    blocked = hints.get("blocked") or set()
    projects = [dict(p) for p in projects if p.get("project_id") and p.get("dir")]
    dir_projects: dict[str, list[dict]] = {}
    for p in projects:
        if not reach.ok(p["dir"]):
            continue  # drive or share isn't there right now; its songs keep their old links
        dir_projects.setdefault(_resolve(Path(p["dir"])), []).append(p)
    for d, plist in dir_projects.items():
        if len(plist) == 1:
            plist[0]["_folder_name"] = Path(d).name
    everyone = [p for plist in dir_projects.values() for p in plist] or projects
    index = _NameIndex(everyone, aliases, saves)
    names = {p["project_id"]: p.get("name") or "" for p in projects}

    extra = [d for d in (extra_dirs or []) if reach.ok(d)]
    _progress.update(folders_total=len(dir_projects) + len(extra), folders_done=0)

    found: dict[tuple[str, str], dict] = {}

    def add(f: Path, root: Path, pid: str, how: str, why: str, sure: bool):
        key = (str(f), pid)  # f is already under a resolved folder
        if key in found and found[key]["match"] == "folder":
            return
        if how != "folder" and (normalize(f.stem), pid) in blocked:
            return  # you said a song named like this isn't from that project
        try:
            st = f.stat()
        except OSError:
            return
        found[key] = {"path": key[0], "project_id": pid, "name": f.stem,
                      "size": st.st_size, "mtime": st.st_mtime, "match": how,
                      "kind": "stem" if is_stem(f, root, names.get(pid, "")) else "song",
                      "why": why, "sure": 1 if sure else 0}

    def out_of_time() -> bool:
        if deadline is not None and time.monotonic() > deadline:
            _progress["timed_out"] = True
            return True
        return False

    # 1) project folders
    for d, plist in dir_projects.items():
        if out_of_time():
            break
        _progress.update(current=Path(d).name)
        files = _audio_files(Path(d), _MAX_DEPTH, skip_samples=True, deadline=deadline)
        if len(plist) == 1:
            for f in files:
                add(f, Path(d), plist[0]["project_id"], "folder", "saved in the project folder", True)
        else:  # a shared folder (common with FL Studio): only names can tell them apart
            local = _NameIndex(plist, aliases, saves)
            for f in files:
                hit = local.match(f.stem, _mtime(f))
                if hit:
                    add(f, Path(d), hit["project_id"], "name", hit["why"], hit["sure"])
        _progress["folders_done"] += 1

    # 2) shared exports folders (Backups' own list, ones it found, Uploader's watch folders)
    seen_dirs: set[str] = set()
    for d in extra:
        if out_of_time():
            break
        rd = _resolve(d)
        _progress.update(current=Path(rd).name)
        if rd not in dir_projects and rd not in seen_dirs:
            seen_dirs.add(rd)
            for f in _audio_files(Path(rd), 6, skip_samples=False, deadline=deadline):
                hit = _match_song(f, Path(rd), index, out_of_time)
                if hit and (normalize(f.stem), hit["project_id"]) not in blocked:
                    add(f, Path(rd), hit["project_id"], "name", hit["why"], hit["sure"])
                elif unmatched is not None:
                    unmatched.append(_unmatched_row(f, Path(rd), index, hit))
        _progress["folders_done"] += 1
    if unmatched is not None:
        linked = {path for path, _pid in found}
        unmatched[:] = [u for u in unmatched if u and u["path"] not in linked]
    return list(found.values())


def _match_song(f: Path, root: Path, index: _NameIndex, out_of_time) -> dict | None:
    """Every clue for one song in an exports folder, surest first."""
    mt = _mtime(f)
    hit = index.match(f.stem, mt)
    if hit:
        return hit
    folder = stem_folder_name(f, root)  # "Night Drive Stems/Kick.wav"
    if folder:
        hit = index.match(folder, mt)
        if hit:
            return {**hit, "sure": False, "why": "it's in this project's stems folder"}
    if not out_of_time():
        tag = audiotags.title(f)
        if tag:
            hit = index.match(tag, mt)
            if hit:
                return {**hit, "sure": False,
                        "why": f"the title saved inside the file is “{tag.strip()}”"}
    if mt is not None:  # a slip of spelling, backed up by when it was exported
        near = [(nearest(index.save_times(p), mt), p) for p in index.close(f.stem)]
        near = [(d, p) for d, p in near if d is not None and d <= _CLOSE_WINDOW]
        if len(near) == 1:
            d, p = near[0]
            return {"project_id": p["project_id"], "sure": False,
                    "why": "the name is spelled almost like this project's, and it was "
                           + _when_text(p, mt, index.save_times(p))}
    return None


def _unmatched_row(f: Path, root: Path, index: _NameIndex, blocked_hit: dict | None) -> dict | None:
    """A song nothing matched, with the project it's most likely from (if any)."""
    try:
        st = f.stat()
    except OSError:
        return None
    exclude = {blocked_hit["project_id"]} if blocked_hit else set()
    sid, why = None, None
    close = [p for p in index.close(f.stem) if p["project_id"] not in exclude]
    if len(close) == 1:
        sid, why = close[0]["project_id"], "the name is spelled almost like this project's"
    else:
        t = index.by_time(st.st_mtime, _DATE_WINDOW, exclude)
        if t:
            p, _gap = t
            sid, why = p["project_id"], _when_text(p, st.st_mtime, index.save_times(p))
    return {"path": str(f), "name": f.stem, "size": st.st_size, "mtime": st.st_mtime,
            "kind": "stem" if is_stem(f, root) else "song",
            "suggest_id": sid, "suggest_why": why}


def export_folders(catalog) -> list[Path]:
    """Folders the user told Backups they save exports into."""
    return [Path(s) for s in (catalog.get_setting("export_folders") or []) if s]


def found_folders(catalog) -> list[Path]:
    """Exports folders Backups found by itself at the last refresh (see below)."""
    return [Path(s) for s in (catalog.get_setting("found_export_folders") or []) if s]


# A folder whose name says it holds finished songs: "Exports", "NEW EXPORTS AIFS:MP3S",
# "Bounces", "Renders", "Mixdowns", "Masters", "WAVS", "MP3s", "Finished".
_EXPORTISH = re.compile(
    r"export|bounce|render|mixdown|master|finished|\bwavs?\b|\bmp3s?\b|\baiff?s?\b",
    re.I)
_FIND_DEPTH = 3          # how far below each starting folder to look
_FIND_DIR_BUDGET = 4000  # stop after this many folders so a huge drive can't stall it


def find_export_folders(catalog, reach: "_Reach | None" = None,
                        deadline: float | None = None) -> list[Path]:
    """Exports folders Backups can find without being told: folders named like
    "Exports" or "Bounces" that hold audio, near the user's projects: in the folders
    Backups scans, one level above them, and beside each project's folder. Only
    places Backups already reads, so it never asks for new disk permissions.
    A project's own folder is left out (step 1 already covers it).

    Turn off with the ``find_export_folders`` setting set to false (or the
    environment variable ``ABLEBACKUP_FIND_EXPORT_FOLDERS=0``)."""
    if catalog.get_setting("find_export_folders") is False \
            or os.environ.get("ABLEBACKUP_FIND_EXPORT_FOLDERS") == "0":
        return []
    ignored = {_resolve(Path(x)) for x in (catalog.get_setting("ignored_export_folders") or [])}
    mine = {_resolve(x) for x in export_folders(catalog)}
    home = Path.home()
    starts: list[Path] = []
    cfg = catalog.get_setting("config") or {}
    for s in cfg.get("sources") or []:
        starts += [Path(s), Path(s).parent]
    reach = reach or _Reach()
    proj_dirs = {_resolve(Path(p["dir"])) for p in catalog.discovered_projects()
                 if p.get("dir") and reach.ok(p["dir"])}
    for d in sorted(proj_dirs)[:500]:
        starts += [Path(d).parent, Path(d).parent.parent]

    found: list[Path] = []
    seen: set[str] = set()
    budget = [_FIND_DIR_BUDGET]

    def walk(d: Path, depth: int):
        if budget[0] <= 0 or (deadline is not None and time.monotonic() > deadline):
            return
        budget[0] -= 1
        try:
            entries = [e for e in os.scandir(d) if e.is_dir(follow_symlinks=False)]
        except OSError:
            return
        for e in entries:
            name = e.name
            if name.startswith(".") or name.lower() in _SKIP_DIRS or name == "Library" \
                    or name.lower().endswith(_PACKAGE_SUFFIXES):
                continue
            rp = _resolve(Path(e.path))
            if rp in seen:
                continue
            seen.add(rp)
            if _EXPORTISH.search(name) and rp not in proj_dirs and not _inside(rp, proj_dirs):
                if rp in ignored or rp in mine:
                    continue
                if _audio_files(Path(e.path), 1, skip_samples=False):
                    found.append(Path(rp))
                    continue  # its subfolders are searched when matching anyway
            if depth < _FIND_DEPTH and rp not in proj_dirs:
                walk(Path(e.path), depth + 1)

    # Logic Pro's own Bounces folder, where a project kept as a package bounces to
    logic = home / "Music" / "Logic" / "Bounces"
    rl = _resolve(logic)
    if rl not in ignored and rl not in mine and reach.ok(logic) \
            and _audio_files(logic, 1, skip_samples=False):
        found.append(Path(rl))
        seen.add(rl)

    for s in starts:
        if not reach.ok(s):
            continue
        rs = _resolve(s)
        if rs in seen or Path(rs) in (home, home.parent, Path(home.anchor)):
            continue
        seen.add(rs)
        walk(Path(rs), 1)
    return found


def _inside(path: str, dirs: set[str]) -> bool:
    p = Path(path)
    return any(str(parent) in dirs for parent in p.parents)


_REFRESH_LIMIT = 120.0  # seconds; a re-check never runs longer than this

# What the current (or last) re-check is doing, for the "Checking for songs…" line.
_progress: dict = {"running": False, "folders_done": 0, "folders_total": 0,
                   "current": "", "linked": None, "timed_out": False}


def progress() -> dict:
    return dict(_progress)


def refresh(catalog, limit: float = _REFRESH_LIMIT) -> int:
    """Re-match exports for every known project and persist them. Returns how many
    automatic links exist afterwards. Best-effort: never raises, and returns within
    about ``limit`` seconds even if the disk stops answering (a folder macOS is
    waiting to ask permission for, a share that went to sleep): the stuck work is
    left behind and its late result thrown away. One at a time, so an older
    re-check can't overwrite a newer one."""
    global _generation
    if not _refresh_lock.acquire(timeout=limit + 10):
        return 0
    try:
        _generation += 1
        gen = _generation
        _progress.update(running=True, folders_done=0, folders_total=0, current="",
                         timed_out=False)
        box: list[int] = []
        deadline = time.monotonic() + limit
        t = threading.Thread(target=lambda: box.append(_refresh(catalog, deadline, gen)),
                             daemon=True, name="exports-match")
        t.start()
        t.join(max(0.0, limit) + 5)
        if not box:
            _progress["timed_out"] = True
            _generation += 1  # whatever the stuck worker finds later is discarded
            return 0
        _progress["linked"] = box[0]
        return box[0]
    finally:
        _progress.update(running=False, current="")
        _refresh_lock.release()


_refresh_lock = threading.Lock()
_generation = 0


def _refresh(catalog, deadline: float, gen: int) -> int:
    try:
        reach = _Reach()
        projects = catalog.discovered_projects()
        found = find_export_folders(catalog, reach, deadline)
        unmatched: list[dict] = []
        h = hints(catalog)
        rows = match_exports(projects, export_folders(catalog) + found + uploader_sources()
                             + h["render_dirs"],
                             deadline=deadline, reach=reach, hints=h, unmatched=unmatched)
        if gen != _generation:
            return 0  # given up on; a newer re-check owns the results
        catalog.set_setting("found_export_folders", [str(f) for f in found])
        # Folders that were skipped (away, or out of time) keep their earlier links.
        keep = _progress.get("timed_out") or bool(reach.dead)
        catalog.replace_unmatched(unmatched, keep_existing=keep)
        return catalog.replace_auto_exports(rows, keep_existing=keep)
    except Exception:
        return 0


def hints(catalog) -> dict:
    """What the catalog knows that helps match songs, for :func:`match_exports`:

    - aliases: names a project had before it was renamed (an earlier backup of a
      project file that's gone, from the folder that now holds just this project),
      and the names of songs you linked to a project by hand;
    - saves: every time a project is known to have been saved or backed up;
    - blocked: songs you said aren't from a project, so ones named like them
      aren't matched to it either."""
    projects = catalog.discovered_projects()
    ids = {p["project_id"] for p in projects}
    by_dir: dict[str, list[dict]] = {}
    for p in projects:
        if p.get("dir"):
            by_dir.setdefault(os.path.normcase(p["dir"]), []).append(p)
    aliases: dict[str, list[tuple[str, str]]] = {}
    saves: dict[str, list[float]] = {}
    for p in projects:
        saves[p["project_id"]] = [t for t in (p.get("mtime"), p.get("backed_mtime")) if t]
    # here, not at the top: tidy imports this module
    from .tidy import _renamed_rows, follower, id_follower
    follow_id = id_follower(catalog)  # ids of projects renamed with Tidy names
    names = {p["project_id"]: p["name"] for p in projects}
    follow = follower(catalog)
    by_path = {os.path.normcase(p["path"]): p for p in projects if p.get("path")}
    for r in _renamed_rows(catalog, ("file",)):  # project files renamed with Tidy names
        cur = by_path.get(os.path.normcase(follow(r["old"])))
        if cur and normalize(Path(r["old"]).stem) != normalize(cur["name"]):
            aliases.setdefault(cur["project_id"], []).append((Path(r["old"]).stem, "old"))
    for s in catalog.snapshot_names():
        pid, t = s.get("project_id"), snapshot_time(s.get("timestamp"))
        pid = follow_id(pid) if pid else pid
        if pid in ids and normalize(s["project_name"]) != normalize(names[pid]):
            aliases.setdefault(pid, []).append((s["project_name"], "old"))
        elif pid not in ids:  # a project file that's gone: renamed, if its folder now holds one
            here = by_dir.get(os.path.normcase(s.get("dir") or ""), [])
            if len(here) != 1:
                continue
            pid = here[0]["project_id"]
            if normalize(s["project_name"]) != normalize(here[0]["name"]):
                aliases.setdefault(pid, []).append((s["project_name"], "old"))
        if t:
            saves.setdefault(pid, []).append(t)
    blocked: set[tuple[str, str]] = set()
    for e in catalog.export_choices():
        key = normalize(e["name"])
        if e["hidden"]:
            blocked.add((key, e["project_id"]))
        elif e["match"] == "manual" and key not in GENERIC and len(key) >= 4:
            aliases.setdefault(e["project_id"], []).append((e["name"], "learned"))
    render_dirs: list[Path] = []
    for p in projects:  # Reaper writes down where it renders and what it calls them
        if p.get("daw") == "reaper" and p.get("path"):
            r = reaper_render(p["path"], p["name"])
            if r:
                render_dirs.append(r[0])
                if normalize(r[1]) != normalize(p["name"]):
                    aliases.setdefault(p["project_id"], []).append((r[1], "render"))
    for pid in aliases:
        aliases[pid] = list(dict.fromkeys(aliases[pid]))
    return {"aliases": aliases, "saves": saves, "blocked": blocked,
            "render_dirs": list(dict.fromkeys(render_dirs))}


def refresh_in_background(catalog, wait: float = 0.0) -> dict:
    """Start a re-check in a background thread (or join the one running) and wait up
    to ``wait`` seconds for it. Returns {"linked": n, "running": False} when it
    finished in time, else {"linked": None, "running": True} and the caller can
    follow :func:`progress`."""
    box: list[int] = []
    t = threading.Thread(target=lambda: box.append(refresh(catalog)), daemon=True,
                         name="exports-refresh")
    t.start()
    t.join(wait)
    return {"linked": box[0], "running": False} if box else {"linked": None, "running": True}


def attach_uploads(exports: list[dict], project_id: str | None = None,
                   follow=None, follow_id=None) -> list[dict]:
    """Annotate exports with their SoundCloud upload (matched by file path), and
    return uploads Uploader attributed to ``project_id`` whose file we don't list
    (moved or deleted renders), so the project still shows them. ``follow`` and
    ``follow_id`` map a path or project id from before a "Tidy names" rename to now."""
    follow = follow or (lambda p: p)
    follow_id = follow_id or (lambda p: p)
    uploads = uploader_uploads()
    by_path: dict[str, dict] = {}
    for u in uploads:
        fp = u.get("file_path")
        if fp:
            u["file_path"] = follow(_resolve(Path(fp)))
            by_path.setdefault(u["file_path"], u)
        if u.get("project_id"):
            u["project_id"] = follow_id(u["project_id"])
    seen: set[str] = set()
    for e in exports:
        u = by_path.get(e["path"])
        e["upload"] = ({"title": u["title"], "url": u["permalink_url"],
                        "uploaded_at": u["timestamp"]} if u else None)
        if u:
            seen.add(e["path"])
    extra = []
    if project_id:
        listed = {e["path"] for e in exports}
        for u in uploads:
            fp = _resolve(Path(u["file_path"])) if u.get("file_path") else ""
            if u.get("project_id") == project_id and fp not in listed and fp not in seen:
                seen.add(fp)
                extra.append({"title": u["title"], "url": u["permalink_url"],
                              "uploaded_at": u["timestamp"], "path": fp})
    return extra
