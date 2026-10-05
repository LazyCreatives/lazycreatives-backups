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

AUDIO_EXTS = {".wav", ".aiff", ".aif", ".aifc", ".flac", ".mp3", ".aac", ".m4a", ".ogg", ".wma"}
_RENDER_EXTS = ("wav", "aifc", "aiff", "aif", "mp3", "flac", "m4a", "ogg", "wma", "aac")

# Subfolders of a project folder that hold *ingredients*, not finished songs:
# Ableton's recorded/frozen/consolidated audio, backups, FL's sliced/recorded audio.
_SKIP_DIRS = {"samples", "backup", "backups", "ableton project info", "recorded",
              "processed", "freeze", "consolidate", "imported", "sliced audio",
              "stems", "audio files", "media", "peaks"}
_MAX_DEPTH = 2  # project root + one or two levels (e.g. "Exports/2026")
# Logic Pro project packages: a folder Finder shows as one file, holding the project's
# own recordings. Never a place finished songs are saved.
_PACKAGE_SUFFIXES = (".logicx", ".logic")


def normalize(name: str) -> str:
    """Reduce a render filename or project name to a comparable key.

    Kept identical to Uploader's ``projectmeta.normalize`` so both apps agree on
    which project a song belongs to."""
    s = (name or "").lower().strip()
    s = re.sub(rf"\.({'|'.join(_RENDER_EXTS)})$", "", s)
    s = re.sub(r"\(autosaved[^)]*\)", " ", s)
    s = re.sub(r"[\[(]\s*\d{1,4}\s*(bpm)?\s*[\])]", " ", s)
    s = re.sub(r"[\s_-]+(v?\d+|master(ed)?|final|mix(down)?|render|bounce|export|wip|draft)\b",
               " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def normalize_keep_numbers(name: str) -> str:
    """Like :func:`normalize` but keeps a bare number that is part of the title, so
    "Freaky 3 master.wav" stays "freaky 3" and finds the project "Freaky 3" even when
    "Freaky", "Freaky 2" and "Freaky 3" all exist. Version tags ("v2") still go."""
    s = (name or "").lower().strip()
    s = re.sub(rf"\.({'|'.join(_RENDER_EXTS)})$", "", s)
    s = re.sub(r"\(autosaved[^)]*\)", " ", s)
    s = re.sub(r"[\[(]\s*\d{1,4}\s*(bpm)?\s*[\])]", " ", s)
    s = re.sub(r"[\s_-]+(v\d+|master(ed)?|final|mix(down)?|render|bounce|export|wip|draft)\b",
               " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
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
                    if depth < max_depth and not (skip_samples and name.lower() in _SKIP_DIRS):
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


def _pick(cands: list[dict], f_mtime: float | None) -> str | None:
    """One project id from candidates sharing a name, or None if it can't be told.
    Two projects with the same name are told apart by which one was saved closest
    to when the song was exported (within a day)."""
    ids = {c["project_id"] for c in cands}
    if len(ids) == 1:
        return ids.pop()
    if f_mtime is None:
        return None
    timed = sorted(((abs((c.get("mtime") or 0) - f_mtime), c["project_id"]) for c in cands))
    best = timed[0]
    if best[0] > _TIME_WINDOW:
        return None
    if len(timed) > 1 and timed[1][0] <= _TIME_WINDOW:
        return None  # two plausible projects saved around then: don't guess
    return best[1]


def _project_names(p: dict) -> list[str]:
    """What a song from this project is likely called: the project's own name, and
    the name of its folder ("Freaky Project" -> "Freaky") when that folder holds
    just this one project, since people often name the export after the folder."""
    names = [p.get("name") or ""]
    folder = p.get("_folder_name")
    if folder:
        names.append(re.sub(r"\s+project$", "", folder.strip(), flags=re.I))
    return names


class _NameIndex:
    """Normalized project names -> projects, for matching a render's file name.

    Tried in order, first hit wins:
      1. the name with its numbers kept ("Freaky 3 master" -> project "Freaky 3"),
         exact, then the longest project name it starts with;
      2. the looser name with trailing numbers dropped ("Night Drive final v2" ->
         "night drive"), exact, then the longest project name it starts with.
    "Starts with" is on a word boundary ("Night Drive - club edit" -> "Night Drive")."""

    def __init__(self, projects: list[dict]):
        self.tiers: list[tuple[callable, dict[str, list[dict]], list[str]]] = []
        for fn in (normalize_keep_numbers, normalize):
            by_key: dict[str, list[dict]] = {}
            for p in projects:
                for k in {fn(n) for n in _project_names(p)}:
                    if len(k) >= 3:  # 1-2 character names are too loose to match on
                        by_key.setdefault(k, []).append(p)
            self.tiers.append((fn, by_key, sorted(by_key, key=len, reverse=True)))

    def match(self, stem: str, f_mtime: float | None) -> str | None:
        for fn, by_key, keys in self.tiers:
            k = fn(stem)
            if not k:
                continue
            if k in by_key:
                pid = _pick(by_key[k], f_mtime)
                if pid:
                    return pid
                continue  # this name is shared and can't be told apart: try the looser key
            for key in keys:  # longest first
                if k.startswith(key + " "):
                    pid = _pick(by_key[key], f_mtime)
                    if pid:
                        return pid
                    break
        return None


def _mtime(f: Path) -> float | None:
    try:
        return f.stat().st_mtime
    except OSError:
        return None


def match_exports(projects: list[dict], extra_dirs: list[Path] | None = None,
                  deadline: float | None = None, reach: "_Reach | None" = None) -> list[dict]:
    """Find audio exports for the given projects (rows with project_id/name/dir).

    Returns one row per (path, project_id): path, project_id, name, size, mtime,
    match ('folder' | 'name'). Pure filesystem; the caller persists it. Folders that
    don't answer quickly (unplugged drive, sleeping network share) are skipped, and
    once ``deadline`` (a ``time.monotonic()`` value) passes it stops looking and
    returns what it found."""
    reach = reach or _Reach()
    projects = [dict(p) for p in projects if p.get("project_id") and p.get("dir")]
    dir_projects: dict[str, list[dict]] = {}
    for p in projects:
        if not reach.ok(p["dir"]):
            continue  # drive or share isn't there right now; its songs keep their old links
        dir_projects.setdefault(_resolve(Path(p["dir"])), []).append(p)
    for d, plist in dir_projects.items():
        if len(plist) == 1:
            plist[0]["_folder_name"] = Path(d).name
    index = _NameIndex([p for plist in dir_projects.values() for p in plist] or projects)

    extra = [d for d in (extra_dirs or []) if reach.ok(d)]
    _progress.update(folders_total=len(dir_projects) + len(extra), folders_done=0)

    found: dict[tuple[str, str], dict] = {}

    def add(f: Path, pid: str, how: str):
        key = (str(f), pid)  # f is already under a resolved folder
        if key in found and found[key]["match"] == "folder":
            return
        try:
            st = f.stat()
        except OSError:
            return
        found[key] = {"path": key[0], "project_id": pid, "name": f.stem,
                      "size": st.st_size, "mtime": st.st_mtime, "match": how}

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
                add(f, plist[0]["project_id"], "folder")
        else:  # a shared folder (common with FL Studio): only names can tell them apart
            local = _NameIndex(plist)
            for f in files:
                pid = local.match(f.stem, _mtime(f))
                if pid:
                    add(f, pid, "name")
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
                pid = index.match(f.stem, _mtime(f))
                if pid:
                    add(f, pid, "name")
        _progress["folders_done"] += 1
    return list(found.values())


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
    proj_dirs = {_resolve(Path(p["dir"])) for p in catalog.discovered_projects()
                 if p.get("dir") and reach.ok(p["dir"])}
    for d in sorted(proj_dirs)[:500]:
        starts += [Path(d).parent, Path(d).parent.parent]

    reach = reach or _Reach()
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
        rows = match_exports(projects, export_folders(catalog) + found + uploader_sources(),
                             deadline=deadline, reach=reach)
        if gen != _generation:
            return 0  # given up on; a newer re-check owns the results
        catalog.set_setting("found_export_folders", [str(f) for f in found])
        # Folders that were skipped (away, or out of time) keep their earlier links.
        keep = _progress.get("timed_out") or bool(reach.dead)
        return catalog.replace_auto_exports(rows, keep_existing=keep)
    except Exception:
        return 0


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


def attach_uploads(exports: list[dict], project_id: str | None = None) -> list[dict]:
    """Annotate exports with their SoundCloud upload (matched by file path), and
    return uploads Uploader attributed to ``project_id`` whose file we don't list
    (moved or deleted renders), so the project still shows them."""
    uploads = uploader_uploads()
    by_path: dict[str, dict] = {}
    for u in uploads:
        fp = u.get("file_path")
        if fp:
            by_path.setdefault(_resolve(Path(fp)), u)
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
