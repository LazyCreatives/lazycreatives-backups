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

# "path": the same folders the project is kept in under its project folder
# ("2024/House"), so backups match a library the producer already sorted by hand.
LEVELS = ("program", "year", "month", "genre", "folder", "path")
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
    if "path" in out:
        return ["path"]  # the producer's own folders already say everything
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


def _own_folder(dirname: str, project_name: str) -> bool:
    """Is this the project's own folder ("Night Drive Project" for "Night Drive")?
    Names in any script count (a Japanese or emoji name normalises to nothing)."""
    bare = re.sub(r"\s*project$", "", dirname, flags=re.I)
    a, b = normalize(bare), normalize(project_name)
    if a and b:
        return a == b
    return bool(bare.strip()) and bare.strip().casefold() == project_name.strip().casefold()


def project_folder_name(project_dir: Path | str | None, project_name: str) -> str:
    """The folder the producer keeps this project in. A project folder of its own
    ("Night Drive Project" for "Night Drive") counts as the project itself, so the
    folder around it is the one that sorts it."""
    if not project_dir:
        return NO_FOLDER
    d = Path(project_dir)
    if _own_folder(d.name, project_name):
        d = d.parent
    if d == d.parent or not d.name:
        return NO_FOLDER
    return safe_folder(d.name, NO_FOLDER)


def project_path(roots, project_dir, project_name: str) -> list[str]:
    """The folders between the project folder it was found in and the project
    ("2024", "House" for <Projects>/2024/House/Night Drive Project/Night Drive.als)."""
    if not project_dir:
        return []
    d = Path(project_dir)
    root = max((Path(r) for r in roots or [] if r and (Path(r) == d or Path(r) in d.parents)),
               key=lambda r: len(r.parts), default=None)
    if root is None:
        return []
    parts = list(d.relative_to(root).parts)
    if parts and _own_folder(d.name, project_name):
        parts = parts[:-1]
    return parts


def level_folders(levels, *, daw: str | None, made: float | None, genre: str | None,
                  folder: str | None, path: list[str] | None = None) -> list[str]:
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
        elif lv == "path":
            out.extend([safe_folder(x, NO_FOLDER) for x in path or []] or [NO_FOLDER])
    return out


def out_levels(levels, upto: str) -> list[str]:
    """The levels that come before ``upto``: a month under a year is just "10 October",
    a month on its own carries its year ("2026-10 October")."""
    lv = clean_levels(levels)
    return lv[:lv.index(upto)]


def dest_parent(base: Path, levels, *, daw: str | None, made: float | None,
                genre: str | None, folder: str | None, path: list[str] | None = None) -> Path:
    """Where a project's own folder goes. The default keeps the program's backup
    folder exactly as it always was (<drive>/AbletonBackups/projects)."""
    if is_default(levels):
        adapter = adapter_for_id(daw or "")
        return base / (adapter.backup_root if adapter else "AbletonBackups") / "projects"
    return base.joinpath(*level_folders(levels, daw=daw, made=made, genre=genre, folder=folder, path=path))


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
                "genre": d["genre"], "folder": project_folder_name(d["dir"], d["name"]),
                "path": project_path(_roots(catalog), d["dir"], d["name"])}
        return {"name": d["name"], "stamp": now, "info": info}
    info = {"daw": "ableton", "made": None, "genre": "House", "folder": "Album ideas", "path": ["2026", "House"]}
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
    path = sort_info.get("path")
    if path is None:
        path = project_path(_roots(catalog), d["dir"], d["name"]) if d else []
    return {"daw": daw, "made": made, "genre": genre, "folder": folder, "path": path}


def _roots(catalog: Catalog) -> list[str]:
    return (catalog.get_setting("config") or {}).get("sources") or []


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
           "undo_sort", "made_time", "project_folder_name", "project_path", "safe_folder", "is_backup_stamp"]


# ---- matching folders that are already there ------------------------------------
# A NAS (or drive) often has folders of its own before Backups is pointed at it:
# backups made some other way, or the producer's projects kept by year or genre.
# Backups reads how they are arranged and offers the same sort, so new backups land
# in the same kind of folders. It only looks; nothing is moved until the producer
# says yes (and then only Backups' own copies move, as for any change of sort).
_YEAR = re.compile(r"^(19|20)\d{2}$")
_MONTH = re.compile(r"^(?:(?:19|20)\d{2}[-_ ])?(?:0?[1-9]|1[0-2])?[-_ .]*(" +
                    "|".join(m[:3] for m in MONTHS) + r")[a-z]*$", re.I)
_MONTH_NUM = re.compile(r"^(?:(?:19|20)\d{2}[-_ ])?(0[1-9]|1[0-2])$")
_PROGRAM_WORDS = {w.lower() for w in PROGRAM_FOLDERS.values()} | {
    "ableton live", "live", "fl", "fruity loops", "logic", "studio one", "bitwig studio",
    "reaper projects", "ableton projects", "fl projects", "logic projects"}
_WALK_DEPTH = 5
_WALK_MOST = 4000  # folders: enough to read the pattern, quick even over Wi-Fi


def _kind_of(names: list[str]) -> str | None:
    """What one level of folders is sorted by, if most of them agree."""
    def share(test):
        return sum(1 for n in names if test(n)) / len(names)
    if share(lambda n: bool(_YEAR.match(n))) >= 0.7:
        return "year"
    if share(lambda n: bool(_MONTH.match(n) or _MONTH_NUM.match(n))) >= 0.7:
        return "month"
    if share(lambda n: n.lower() in _PROGRAM_WORDS or n in BACKUP_ROOTS) >= 0.7:
        return "program"
    from ablebackup.genre import _hits
    if share(lambda n: n == NO_GENRE or bool(_hits(n.lower()))) >= 0.5:
        return "genre"
    return None


def _levels_from(paths: list[tuple[str, ...]]) -> list[str] | None:
    """The sort that explains the folders above each project, or None when there's
    no clear pattern (projects at many depths, or the folders mean nothing)."""
    if len(paths) < 2:
        return None
    depths: dict[int, int] = {}
    for p in paths:
        depths[len(p)] = depths.get(len(p), 0) + 1
    depth, count = max(depths.items(), key=lambda kv: (kv[1], kv[0]))
    if depth == 0 or count / len(paths) < 0.6:
        return None
    same = [p for p in paths if len(p) == depth]
    if depth > MAX_LEVELS + 1:
        same = [p[-MAX_LEVELS:] for p in same]  # a deep share: only the last few count
        depth = MAX_LEVELS
    levels: list[str] = []
    for i in range(depth):
        names = [p[i] for p in same]
        kind = _kind_of(names)
        if kind is None:
            # The folder each project sits in, like "Album ideas" (only right next
            # to the project, and only once); anything else unclear: no match.
            if i == depth - 1 and "folder" not in levels and len(set(names)) > 1:
                kind = "folder"
            elif i == 0 and depth > 1:
                continue  # a top folder that holds everything ("Music Projects")
            else:
                return None
        if kind in levels:
            return None
        levels.append(kind)
    return clean_levels(levels) if levels else None


def _walk_projects(base: Path) -> list[tuple[str, ...]]:
    """The folders above each project or backed-up project under base."""
    from ablebackup.daws.registry import all_extensions, package_extensions
    exts = tuple(all_extensions())
    pkgs = tuple(package_extensions())
    out: list[tuple[str, ...]] = []
    seen = 0
    stack = [(base, ())]
    while stack and seen < _WALK_MOST:
        d, rel = stack.pop()
        seen += 1
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        dirs = []
        is_project = False
        for e in entries:
            name = e.name
            if name.startswith(".") or name in (POOL_DIR, "_pool"):
                continue
            try:
                is_dir = e.is_dir(follow_symlinks=False)
            except OSError:
                continue
            if is_dir and STAMP_RE.match(name):
                is_project = True  # a project's backups: <project>/<date>
            elif is_dir and name.lower().endswith(pkgs):
                out.append(rel)     # a Logic project is a folder of its own
            elif is_dir:
                dirs.append(name)
            elif name.lower().endswith(exts):
                is_project = True
        if is_project and rel:
            out.append(rel[:-1])
            continue  # nothing to learn inside a project
        if len(rel) < _WALK_DEPTH:
            stack.extend((Path(d) / n, rel + (n,)) for n in dirs)
    return out


def detect(catalog: Catalog, base: Path | None) -> dict | None:
    """{levels, where: "backups" | "projects", example}: how the folders already in
    the backup place (else the producer's project folders) are arranged, when that
    is clear and isn't how backups are sorted now. None otherwise."""
    current = get_sort(catalog)
    if current == ["path"]:
        return None  # already in the same folders as the projects: the closest match there is
    tries: list[tuple[str, list[tuple[str, ...]]]] = []
    if base and base.is_dir():
        # Backups' own plain folders (AbletonBackups/projects, by-date) say nothing
        # about how the producer likes things sorted: leave them out.
        found = [p for p in _walk_projects(base) if p and p[0] not in BACKUP_ROOTS and p != ("program",)]
        tries.append(("backups", found))
    roots = [Path(s) for s in (catalog.get_setting("config") or {}).get("sources", [])]
    rels = []
    for p in catalog.discovered_projects():
        d = Path(p.get("dir") or "")
        root = next((r for r in roots if r in d.parents), None)
        if root is None:
            continue
        rel = d.relative_to(root).parts
        rels.append(rel[:-1] if _own_folder(d.name, p.get("name") or "") else rel)
    tries.append(("projects", rels))
    for where, paths in tries:
        kinds = _levels_from(paths)
        if not kinds:
            continue
        # Your own project folders: the backups go in exactly the same folders (their
        # year or genre is what the folder says, not a guess). Folders already in the
        # backup place: sorted the same way, from each project's details.
        levels = ["path"] if where == "projects" else kinds
        if levels == current:
            return None  # already sorted like this
        ex = _example_project(catalog)
        return {"levels": levels, "kinds": kinds, "where": where,
                "example": level_folders(levels, **ex["info"]) + [ex["name"], ex["stamp"]]}
    return None
