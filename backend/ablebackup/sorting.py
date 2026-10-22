"""How backup copies are sorted into folders on the backup drive, and moving the
copies already there when the sort changes (with Undo).

The producer picks up to three levels (program, year, month, genre, their own
project folder); every backup then sits at <drive>/<level>/<level>/<level>/<project>/
<date>. The plain default (program only) keeps the folders Backups always made,
<drive>/AbletonBackups/projects/<project>/<date>, so nothing moves for anyone who
never touches the setting.

Only backup copies are ever moved, never the producer's own projects or songs.
"""
import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path

from ablebackup.catalog import Catalog
from ablebackup.daws.base import BACKUP_ROOTS, STAMP_RE
from ablebackup.daws.registry import DAW_REGISTRY, adapter_for_id
from ablebackup.exports import normalize

LEVELS = ("program", "year", "month", "genre", "folder")
DEFAULT_SORT = ["program"]
MAX_LEVELS = 3
SORT_KEY = "backup_sort"
UNDO_KEY = "backup_sort_undo"

# One shared pool of unique files for the whole drive, once the backups are sorted
# any other way than by program. Hidden, so scans and file browsers pass it by.
POOL_DIR = ".pool"

PROGRAM_FOLDERS = {
    "ableton": "Ableton", "flstudio": "FL Studio", "logic": "Logic Pro",
    "reaper": "Reaper", "bitwig": "Bitwig", "studioone": "Studio One",
    "audacity": "Audacity", "dawproject": "DAWproject", "stems": "Stems only",
}
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December")
NO_GENRE = "No genre"
NO_FOLDER = "Other projects"

def clean_levels(levels) -> list[str]:
    """The levels as saved: known ones only, each once, at most three, never none."""
    out: list[str] = []
    for lv in levels or []:
        if lv in LEVELS and lv not in out:
            out.append(lv)
    return out[:MAX_LEVELS] or list(DEFAULT_SORT)


def get_sort(catalog: Catalog) -> list[str]:
    return clean_levels(catalog.get_setting(SORT_KEY) or DEFAULT_SORT)


def is_default(levels) -> bool:
    return clean_levels(levels) == DEFAULT_SORT


_BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)),
             *(f"lpt{i}" for i in range(1, 10))}


def safe_folder(name: str, fallback: str) -> str:
    """A folder name every computer accepts: no slashes or other banned marks, no
    dot or space at the end, not a name Windows keeps for itself, not too long."""
    s = _BAD_CHARS.sub(" ", name or "")
    s = re.sub(r"\s+", " ", s).strip().rstrip(". ")[:80].rstrip(". ")
    if not s or s.startswith(".") or s.lower().split(".")[0] in _RESERVED:
        return fallback
    return s


def made_time(project_path: Path | str | None, fallback: float | None = None) -> float | None:
    """When the project was started: the earlier of the file's birth and save times
    (Linux keeps no birth time, so there it is the save time)."""
    if project_path:
        try:
            st = os.stat(project_path)
            born = getattr(st, "st_birthtime", None)
            return min(born, st.st_mtime) if born else st.st_mtime
        except OSError:
            pass
    return fallback


def project_folder_name(project_dir: Path | str | None, project_name: str) -> str:
    """The folder the producer keeps this project in. A project folder of its own
    ("Night Drive Project" for "Night Drive") counts as the project itself, so the
    folder around it is the one that sorts it."""
    if not project_dir:
        return NO_FOLDER
    d = Path(project_dir)
    own = normalize(re.sub(r"\s*project$", "", d.name, flags=re.I))
    if own and own == normalize(project_name):
        d = d.parent
    if d == d.parent or not d.name:
        return NO_FOLDER
    return safe_folder(d.name, NO_FOLDER)


def level_folders(levels, *, daw: str | None, made: float | None, genre: str | None,
                  folder: str | None) -> list[str]:
    """The folder names above the project folder, for one project."""
    when = datetime.fromtimestamp(made) if made else datetime.now()
    out: list[str] = []
    for lv in clean_levels(levels):
        if lv == "program":
            out.append(PROGRAM_FOLDERS.get(daw or "", safe_folder(daw or "", "Other programs")))
        elif lv == "year":
            out.append(str(when.year))
        elif lv == "month":
            name = f"{when.month:02d} {MONTHS[when.month - 1]}"
            out.append(name if "year" in out_levels(levels, lv) else f"{when.year}-{name}")
        elif lv == "genre":
            out.append(safe_folder(genre or "", NO_GENRE))
        elif lv == "folder":
            out.append(folder or NO_FOLDER)
    return out


def out_levels(levels, upto: str) -> list[str]:
    """The levels that come before ``upto``: a month under a year is just "10 October",
    a month on its own carries its year ("2026-10 October")."""
    lv = clean_levels(levels)
    return lv[:lv.index(upto)]


def dest_parent(base: Path, levels, *, daw: str | None, made: float | None,
                genre: str | None, folder: str | None) -> Path:
    """Where a project's own folder goes. The default keeps the program's backup
    folder exactly as it always was (<drive>/AbletonBackups/projects)."""
    if is_default(levels):
        adapter = adapter_for_id(daw or "")
        return base / (adapter.backup_root if adapter else "AbletonBackups") / "projects"
    return base.joinpath(*level_folders(levels, daw=daw, made=made, genre=genre, folder=folder))


def pool_for(base: Path, daw: str | None, levels) -> Path:
    """The pool of unique files a backup links to. Once a drive has the shared pool
    (it is made the first time the backups are sorted another way), every backup
    uses it, whatever the sort, so switching back never copies anything twice."""
    shared = base / POOL_DIR
    if shared.is_dir() or not is_default(levels):
        return shared
    adapter = adapter_for_id(daw or "")
    return base / (adapter.backup_root if adapter else "AbletonBackups") / "_pool"


def all_pools(base: Path) -> list[Path]:
    return [base / POOL_DIR] + [base / a.backup_root / "_pool" for a in DAW_REGISTRY]


# ---- what to show ----------------------------------------------------------------
def preview(catalog: Catalog, base: Path | None, levels) -> dict:
    """An example path for one real project (the most recently backed up, else any
    found one), and how many backups would move to fit the new sort."""
    levels = clean_levels(levels)
    ex = _example_project(catalog)
    parts = level_folders(levels, **ex["info"]) if not is_default(levels) else \
        [_program_root(ex["info"]["daw"]), "projects"]
    moves = plan_moves(catalog, base, levels) if base and base.is_dir() else []
    return {"levels": levels, "example": parts + [ex["name"], ex["stamp"]],
            "moves": len(moves)}


def _program_root(daw: str | None) -> str:
    adapter = adapter_for_id(daw or "")
    return adapter.backup_root if adapter else "AbletonBackups"


def _example_project(catalog: Catalog) -> dict:
    """The project the preview shows: the latest backup, else any project found,
    else a made-up one for a brand new setup."""
    now = datetime.now().strftime("%Y-%m-%d_%H%M")
    with catalog._lock:
        snap = catalog.conn.execute(
            "SELECT id, project_name, timestamp, dir, project_id, daw, genre FROM snapshots "
            "WHERE status != 'error' ORDER BY id DESC LIMIT 1").fetchone()
        found = {r["project_id"]: dict(r) for r in catalog.conn.execute(
            "SELECT project_id, name, path, dir, daw, genre, mtime, made FROM discovered "
            "ORDER BY mtime DESC LIMIT 1" if snap is None else
            "SELECT project_id, name, path, dir, daw, genre, mtime, made FROM discovered "
            "WHERE project_id = ?", () if snap is None else (snap["project_id"] or "",))}
    if snap is not None:
        s = dict(snap)
        info = _snapshot_info(catalog, s, _read_manifest(Path(s["dir"])) if s["dir"] else {}, found)
        return {"name": s["project_name"], "stamp": s["timestamp"], "info": info}
    if found:
        d = next(iter(found.values()))
        info = {"daw": d["daw"], "made": d.get("made") or made_time(d["path"], d["mtime"]),
                "genre": d["genre"], "folder": project_folder_name(d["dir"], d["name"])}
        return {"name": d["name"], "stamp": now, "info": info}
    info = {"daw": "ableton", "made": None, "genre": "House", "folder": "Album ideas"}
    return {"name": "Night Drive", "stamp": now, "info": info}


# ---- moving the copies already there ---------------------------------------------
def _snapshot_info(catalog: Catalog, snap: dict, manifest: dict, found: dict) -> dict:
    """What sorts one backup. The project as last found wins (its genre may have
    been set since); the backup's own notes cover a project that has gone."""
    d = found.get(snap.get("project_id") or "")
    sort_info = manifest.get("sort") or {}
    daw = snap.get("daw") or manifest.get("daw") or (d or {}).get("daw")
    made = min((t for t in (sort_info.get("made"), (d or {}).get("made"),
                            made_time(d["path"], d.get("mtime")) if d else None) if t), default=None)
    if made is None:
        try:
            made = datetime.strptime(snap["timestamp"][:15], "%Y-%m-%d_%H%M").timestamp()
        except (ValueError, TypeError):
            made = None
    folder = sort_info.get("folder") or (project_folder_name(d["dir"], d["name"]) if d else None)
    if folder is None:
        src = next((f.get("source_path") for f in manifest.get("files", [])
                    if f.get("inside_project") and "/" not in f.get("logical_path", "/")), None)
        folder = project_folder_name(Path(src).parent, snap["project_name"]) if src else NO_FOLDER
    genre = (d or {}).get("genre") or snap.get("genre")
    return {"daw": daw, "made": made, "genre": genre, "folder": folder}


def _read_manifest(d: Path) -> dict:
    try:
        return json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def plan_moves(catalog: Catalog, base: Path, levels) -> list[dict]:
    """Every backup on this drive that is not where the sort puts it: {id, old, new,
    project_id}. Backups that are missing, or elsewhere, are left alone."""
    levels = clean_levels(levels)
    base = Path(base)
    try:
        base_r = base.resolve()
    except OSError:
        return []
    found = {r["project_id"]: dict(r) for r in catalog.conn.execute(
        "SELECT project_id, name, path, dir, daw, genre, mtime, made FROM discovered")}
    rows = [dict(r) for r in catalog.conn.execute(
        "SELECT id, project_name, timestamp, dir, project_id, daw, genre FROM snapshots "
        "WHERE dir IS NOT NULL AND dir != '' AND status != 'error' ORDER BY id")]
    moves: list[dict] = []
    taken: set[str] = set()
    claims: dict[str, str] = {}  # project folder -> the project planned into it
    for s in rows:
        old = Path(s["dir"])
        try:
            if not old.resolve().is_relative_to(base_r) or not old.is_dir():
                continue
        except OSError:
            continue
        info = _snapshot_info(catalog, s, _read_manifest(old), found)
        parent = dest_parent(base, levels, **info)
        name = safe_folder(s["project_name"], "Project")
        stamp = old.name if STAMP_RE.match(old.name) else safe_folder(s["timestamp"], "Backup")
        new = _free_project_folder(parent, name, s.get("project_id") or "", claims) / stamp
        if os.path.normcase(str(new)) == os.path.normcase(str(old)):
            continue
        if new.exists() or str(new) in taken:
            continue  # something is there already: leave this one where it is
        taken.add(str(new))
        moves.append({"id": s["id"], "old": str(old), "new": str(new),
                      "project_id": s.get("project_id") or ""})
    return moves


def _free_project_folder(parent: Path, name: str, project_id: str, claims: dict) -> Path:
    """The project's folder under ``parent``: its own if it has one there, else the
    plain name unless another project has it, else the name with a short id."""
    folder = parent / name
    owner = claims.get(str(folder))
    if owner is None:
        try:
            owner = (folder / ".abid").read_text().strip()
        except OSError:
            owner = None
    if project_id and owner and owner != project_id:
        folder = parent / f"{name} ({project_id[:6]})"
    claims.setdefault(str(folder), project_id)
    return folder


def move_backups(catalog: Catalog, base: Path, moves: list[dict], progress=None) -> dict:
    """Move each backup folder (a rename on the same drive, so it is quick and the
    files are not copied). A move that fails is skipped; the backup stays where it
    was and is still found. Returns what moved, for Undo."""
    done: list[dict] = []
    failed = 0
    for i, m in enumerate(moves):
        old, new = Path(m["old"]), Path(m["new"])
        try:
            new.parent.mkdir(parents=True, exist_ok=True)
            if m.get("project_id"):
                (new.parent / ".abid").write_text(m["project_id"])
            if new.exists():
                raise FileExistsError(str(new))
            os.rename(old, new)
        except OSError:
            failed += 1
            continue
        with catalog._lock:
            catalog.conn.execute("UPDATE snapshots SET dir = ? WHERE id = ?", (str(new), m["id"]))
            catalog.conn.commit()
        done.append(m)
        if progress:
            progress(i + 1, len(moves))
    tidy_empty(base, [Path(m["old"]).parent for m in done])
    return {"moved": done, "failed": failed}


def tidy_empty(base: Path, folders) -> None:
    """Remove the folders a move left empty (only Backups' own marker inside), up to
    the drive's top. Never anything with a file of the producer's in it."""
    base = Path(base)
    for start in sorted({Path(f) for f in folders}, key=lambda p: len(p.parts), reverse=True):
        d = start
        while d != base and base in d.parents:
            try:
                left = [e.name for e in os.scandir(d)]
            except OSError:
                break
            if set(left) - {".abid", ".DS_Store", "Thumbs.db", "desktop.ini"}:
                break
            for n in left:
                try:
                    os.unlink(d / n)
                except OSError:
                    pass
            try:
                os.rmdir(d)
            except OSError:
                break
            d = d.parent


def share_pool(base: Path) -> int:
    """Move every program's pool of unique files into the drive's one shared pool,
    so a sort that mixes programs still saves space. A file both pools hold is kept
    once (the backups linked to the other copy keep it). Returns files moved."""
    base = Path(base)
    shared = base / POOL_DIR
    moved = 0
    for a in DAW_REGISTRY:
        old = base / a.backup_root / "_pool"
        if not old.is_dir():
            continue
        for dirpath, _dirs, files in os.walk(old):
            for fn in files:
                if fn.endswith(".tmp"):
                    continue
                src = Path(dirpath) / fn
                dst = shared / src.relative_to(old)
                try:
                    if dst.exists():
                        os.unlink(src)
                    else:
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        os.rename(src, dst)
                        moved += 1
                except OSError:
                    continue
        for dirpath, dirs, files in os.walk(old, topdown=False):
            if not files and not dirs:
                try:
                    os.rmdir(dirpath)
                except OSError:
                    pass
        try:
            os.rmdir(old)
        except OSError:
            pass
    tidy_empty(base, [base / a.backup_root / sub for a in DAW_REGISTRY for sub in ("projects", "by-date")])
    tidy_empty(base, [base / a.backup_root for a in DAW_REGISTRY])
    return moved


def apply_sort(catalog: Catalog, base: Path | None, levels, progress=None) -> dict:
    """Save the new sort and move the backups already on the drive to fit it.
    Undo puts them back and the old sort with them."""
    levels = clean_levels(levels)
    before = get_sort(catalog)
    moves: list[dict] = []
    failed = 0
    if base and Path(base).is_dir():
        base = Path(base)
        if not is_default(levels) or (base / POOL_DIR).is_dir():
            share_pool(base)
        res = move_backups(catalog, base, plan_moves(catalog, base, levels), progress)
        moves, failed = res["moved"], res["failed"]
    catalog.set_setting(SORT_KEY, levels)
    catalog.set_setting(UNDO_KEY, {"from": before, "to": levels, "base": str(base or ""),
                                   "moves": moves})
    return {"levels": levels, "moved": len(moves), "failed": failed, "undo": bool(moves) or before != levels}


def undo_sort(catalog: Catalog) -> dict:
    """Put the backups the last change moved back where they were, and the sort
    before it. Backups made since stay where they are (and are still found)."""
    u = catalog.get_setting(UNDO_KEY)
    if not u:
        return {"levels": get_sort(catalog), "moved": 0, "failed": 0, "undo": False}
    back = [{"id": m["id"], "old": m["new"], "new": m["old"], "project_id": m.get("project_id", "")}
            for m in reversed(u.get("moves", []))]
    moved = failed = 0
    if back and u.get("base") and Path(u["base"]).is_dir():
        res = move_backups(catalog, Path(u["base"]), back)
        moved, failed = len(res["moved"]), res["failed"]
    catalog.set_setting(SORT_KEY, clean_levels(u.get("from")))
    catalog.set_setting(UNDO_KEY, None)
    return {"levels": get_sort(catalog), "moved": moved, "failed": failed, "undo": False}


def is_backup_stamp(name: str) -> bool:
    return bool(STAMP_RE.match(name))


__all__ = ["LEVELS", "DEFAULT_SORT", "BACKUP_ROOTS", "clean_levels", "get_sort", "is_default",
           "dest_parent", "pool_for", "all_pools", "preview", "plan_moves", "apply_sort",
           "undo_sort", "made_time", "project_folder_name", "safe_folder", "is_backup_stamp"]
