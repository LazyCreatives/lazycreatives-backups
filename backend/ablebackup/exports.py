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
from pathlib import Path

AUDIO_EXTS = {".wav", ".aiff", ".aif", ".flac", ".mp3", ".aac", ".m4a", ".ogg", ".wma"}
_RENDER_EXTS = ("wav", "aif", "aiff", "mp3", "flac", "m4a", "ogg", "wma", "aac")

# Subfolders of a project folder that hold *ingredients*, not finished songs:
# Ableton's recorded/frozen/consolidated audio, backups, FL's sliced/recorded audio.
_SKIP_DIRS = {"samples", "backup", "backups", "ableton project info", "recorded",
              "processed", "freeze", "consolidate", "imported", "sliced audio",
              "stems", "audio files", "media", "peaks"}
_MAX_DEPTH = 2  # project root + one or two levels (e.g. "Exports/2026")


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
def _audio_files(root: Path, max_depth: int, skip_samples: bool) -> list[Path]:
    out: list[Path] = []

    def walk(d: Path, depth: int):
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
                    if depth < max_depth and not (skip_samples and name.lower() in _SKIP_DIRS):
                        walk(Path(e.path), depth + 1)
                elif e.is_file() and Path(name).suffix.lower() in AUDIO_EXTS:
                    out.append(Path(e.path))
            except OSError:
                continue

    if root.is_dir():
        walk(root, 0)
    return out


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


class _NameIndex:
    """Normalized project names -> projects, for matching a render's file name.

    Exact match first ("Night Drive final v2" -> "night drive"); otherwise the
    longest project name the file name *starts with*, on a word boundary
    ("Night Drive - Robert (club edit)" -> "night drive")."""

    def __init__(self, projects: list[dict]):
        self.by_key: dict[str, list[dict]] = {}
        for p in projects:
            k = normalize(p.get("name") or "")
            if len(k) >= 3:  # "a", "untitled 2" -> "untitled" still OK; 1-2 chars too loose
                self.by_key.setdefault(k, []).append(p)
        self.keys = sorted(self.by_key, key=len, reverse=True)

    def match(self, stem: str, f_mtime: float | None) -> str | None:
        k = normalize(stem)
        if not k:
            return None
        if k in self.by_key:
            return _pick(self.by_key[k], f_mtime)
        for key in self.keys:  # longest first
            if k.startswith(key + " "):
                return _pick(self.by_key[key], f_mtime)
        return None


def _mtime(f: Path) -> float | None:
    try:
        return f.stat().st_mtime
    except OSError:
        return None


def match_exports(projects: list[dict], extra_dirs: list[Path] | None = None) -> list[dict]:
    """Find audio exports for the given projects (rows with project_id/name/dir).

    Returns one row per (path, project_id): path, project_id, name, size, mtime,
    match ('folder' | 'name'). Pure filesystem; the caller persists it."""
    projects = [p for p in projects if p.get("project_id") and p.get("dir")]
    index = _NameIndex(projects)
    dir_projects: dict[str, list[dict]] = {}
    for p in projects:
        dir_projects.setdefault(_resolve(Path(p["dir"])), []).append(p)

    found: dict[tuple[str, str], dict] = {}

    def add(f: Path, pid: str, how: str):
        key = (_resolve(f), pid)
        if key in found and found[key]["match"] == "folder":
            return
        try:
            st = f.stat()
        except OSError:
            return
        found[key] = {"path": key[0], "project_id": pid, "name": f.stem,
                      "size": st.st_size, "mtime": st.st_mtime, "match": how}

    # 1) project folders
    for d, plist in dir_projects.items():
        files = _audio_files(Path(d), _MAX_DEPTH, skip_samples=True)
        if len(plist) == 1:
            for f in files:
                add(f, plist[0]["project_id"], "folder")
        else:  # a shared folder (common with FL Studio): only names can tell them apart
            local = _NameIndex(plist)
            for f in files:
                pid = local.match(f.stem, _mtime(f))
                if pid:
                    add(f, pid, "name")

    # 2) shared exports folders (Backups' own list + Uploader's watch folders)
    seen_dirs: set[str] = set()
    for d in extra_dirs or []:
        rd = _resolve(d)
        if rd in dir_projects or rd in seen_dirs:
            continue
        seen_dirs.add(rd)
        for f in _audio_files(d, 6, skip_samples=False):
            pid = index.match(f.stem, _mtime(f))
            if pid:
                add(f, pid, "name")
    return list(found.values())


def export_folders(catalog) -> list[Path]:
    """Folders the user told Backups they save exports into."""
    return [Path(s) for s in (catalog.get_setting("export_folders") or []) if s]


def refresh(catalog) -> int:
    """Re-match exports for every known project and persist them. Returns how many
    automatic links exist afterwards. Best-effort: never raises."""
    try:
        projects = catalog.discovered_projects()
        rows = match_exports(projects, export_folders(catalog) + uploader_sources())
        return catalog.replace_auto_exports(rows)
    except Exception:
        return 0


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
