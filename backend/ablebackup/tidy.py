"""Tidy names: give one song's project versions, its folder and its exported songs
consistent names in one go ("Glasshouse v2.als", "Glasshouse FINAL 3.als",
"glasshouse final 3 master.wav" -> "Glasshouse v1.als", "Glasshouse v2.als",
"Glasshouse v2 (master).wav"), without breaking anything a music program needs.

What it renames, and only this:
  * the project files themselves (each saved version of the song),
  * the songs exported from them (wherever they were found),
  * the project folder, when it holds only this song.

What it never touches: anything inside a project file, and anything inside the
project folder other than the files above (samples, recordings, Ableton's Backup
and "Ableton Project Info" folders, Logic's package contents, Studio One's Media
and History folders, FL Studio's and Reaper's audio folders). Programs find those
by their place relative to the project, so they keep working after a rename.

The one thing that can break is a program that remembers a sample inside the
project folder by its full address (FL Studio does; Reaper and Studio One
sometimes do). Renaming the folder would change that address, so for those
projects the folder keeps its name and only the files are renamed. Old
Audacity projects (.aup) find their audio by the project's own name, so they
keep it.

Nothing changes until the user presses Rename. Every rename is written down and
one Undo puts every name back. Backups' own records (the project list, songs,
backups) follow the new names; the backup copies already made keep the names
they were made with (they are a record of the project as it was), and still show
under the renamed project.
"""
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

from ablebackup import exports as ex
from ablebackup.daws.registry import adapter_for_path

# How versions are numbered: "Glasshouse v2" or "Glasshouse v02".
VERSION_STYLES = {"v": "{base} v{n}", "v0": "{base} v{n:02d}"}
# How an exported song's extra words are added: "Glasshouse v2 (master)".
SONG_STYLES = {"paren": "{name} ({extra})", "dash": "{name} - {extra}"}

# Words that only say "which save this was", dropped from a suggested song name and
# from what an export adds to its project's name.
_NOISE = re.compile(r"^(v\d+|\d+|final|finished|done|latest|new|copy|autosaved|"
                    r"export(ed)?|render(ed)?|bounce[d]?|wip|draft|version)$", re.I)
_BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_MAX_NAME = 180


class TidyError(Exception):
    """Something the person should be told in plain words."""


# ---- names --------------------------------------------------------------------
def _words(s: str) -> list[str]:
    s = re.sub(r"\(autosaved[^)]*\)", " ", s, flags=re.I)
    s = re.sub(r"[\[(]\s*\d{1,4}\s*(bpm)?\s*[\])]", " ", s, flags=re.I)
    return [w for w in re.split(r"[\s_]+", s) if w]


def suggest_base(name: str) -> str:
    """The song's name without the version words on the end:
    "Glasshouse FINAL 3" -> "Glasshouse", "Night Drive v2 copy" -> "Night Drive"."""
    words = _words(name)
    while words and (_NOISE.match(words[-1]) or words[-1] in ("-", "–")):
        words.pop()
    base = " ".join(words).strip(" -_–")
    return base or name.strip()


def version_number(name: str) -> int | None:
    """The version number someone already wrote in a name: "Glasshouse v2" -> 2,
    "Glasshouse FINAL 3" -> 3, "Glasshouse" -> None."""
    for w in reversed(_words(name)):
        m = re.match(r"^v?(\d{1,4})$", w, re.I)
        if m:
            return int(m.group(1))
    return None


def numbering(members: list[dict], keep: bool) -> list[int]:
    """A version number per project (oldest first). keep: the numbers already in the
    names where they're unique, the rest filled in with the lowest free ones."""
    if not keep:
        return list(range(1, len(members) + 1))
    nums: list[int | None] = []
    used: set[int] = set()
    for m in members:
        n = version_number(m["name"])
        if n is None or n in used or n == 0:
            nums.append(None)
        else:
            nums.append(n)
            used.add(n)
    free = (i for i in range(1, 10000) if i not in used)
    return [n if n is not None else next(free) for n in nums]


def _best_spelling(names: list[str]) -> str:
    """Of the versions' names (newest first), the newest one written with capitals:
    "freaky 3 final" and "Freaky 2" suggest "Freaky"."""
    for n in names:
        if any(c.isupper() for c in n):
            return n
    return names[0]


def song_key(name: str) -> str:
    """Versions of one song share this (the same rule that links exports to projects)."""
    return ex.normalize(name)


def clean_name(s: str) -> str:
    """A name that is safe as a file name on Windows, Mac and Linux."""
    s = _BAD_CHARS.sub(" ", s or "")
    s = re.sub(r"\s+", " ", s).strip().strip(".")
    return s[:_MAX_NAME].strip()


def _extra_words(export_stem: str, project_name: str) -> str:
    """What an export's name adds to its project's: "glasshouse final 3 master" from
    the project "Glasshouse FINAL 3" -> "master"; "Glasshouse - club edit" -> "club edit"."""
    own = {w.lower() for w in _words(project_name)}
    keep = [w for w in _words(export_stem)
            if w.lower() not in own and not _NOISE.match(w) and w not in ("-", "–")]
    return " ".join(keep).strip(" -_–()")


# ---- paths --------------------------------------------------------------------
def _key(p) -> str:
    return os.path.normcase(os.path.realpath(str(p)))


def _under(path: str, folder: str) -> bool:
    """Is a stored path (from any computer) inside this folder?"""
    a = os.path.normcase(str(path).replace("\\", "/"))
    b = os.path.normcase(str(folder).replace("\\", "/")).rstrip("/")
    return a.startswith(b + "/")


def _holds_full_addresses(project_path: Path, folder: Path) -> bool:
    """Does this project remember something inside its folder by full address only?
    Then renaming the folder would make it go missing. Unreadable counts as yes."""
    adapter = adapter_for_path(project_path)
    if adapter is None:
        return True
    try:
        refs = adapter.parse_project(project_path)
    except Exception:
        return True
    real = os.path.realpath(folder)
    for r in refs:
        if r.relative_path and adapter.daw_id not in _FOLDER_NAME_IN_PATH:
            continue  # found by its place relative to the project: survives a rename
        a = r.absolute_path or ""
        if a and (_under(a, folder) or _under(a, real)):
            return True
    return False


# Programs whose way of finding a recording relative to the song depends on the song
# folder keeping its name (Studio One looks in "<song folder>/Media").
_FOLDER_NAME_IN_PATH = {"studioone"}


def _used_files(members: list[dict], folder: Path) -> tuple[set[str], bool]:
    """Every file the versions play (samples, recordings), so none of them is ever
    taken for an exported song and renamed. Also says whether every version could
    be read; if one couldn't, nothing inside the folder is treated as a song."""
    from ablebackup.scanner import scan_one
    used: set[str] = set()
    ok = True
    for m in members:
        try:
            scan = scan_one(Path(m["path"]))
        except Exception:
            ok = False
            continue
        for r in scan.refs:
            if r.resolved_path is not None:
                used.add(_key(r.resolved_path))
    return used, ok


def _keeps_own_name(project_path: Path) -> str | None:
    """Why this project file must keep its name, or None."""
    if project_path.suffix.lower() == ".aup":
        return "Old Audacity projects find their audio by the project's name, so this one keeps it."
    return None


# ---- the plan -----------------------------------------------------------------
def _discovered(catalog) -> list[dict]:
    with catalog._lock:
        rows = catalog.conn.execute(
            "SELECT project_id, name, path, dir, daw, mtime FROM discovered").fetchall()
    return [dict(r) for r in rows]


def _uploaded(catalog) -> set[str]:
    follow = follower(catalog)
    out = set()
    for u in ex.uploader_uploads():
        if u.get("file_path"):
            out.add(_key(follow(ex._resolve(Path(u["file_path"])))))
    return out


def _groups(catalog, project_ids: list[str]) -> list[dict]:
    """The songs the picked projects belong to: each picked project plus the other
    versions of it saved in the same folder."""
    rows = [r for r in _discovered(catalog) if r.get("path")]
    by_id = {r["project_id"]: r for r in rows}
    out: list[dict] = []
    seen: set[tuple] = set()
    for pid in project_ids:
        p = by_id.get(pid)
        if p is None:
            continue
        gk = (_key(p["dir"]), song_key(p["name"]))
        if gk in seen:
            continue
        seen.add(gk)
        members = [r for r in rows if _key(r["dir"]) == gk[0] and song_key(r["name"]) == gk[1]
                   and os.path.exists(r["path"])]
        if not members:
            continue
        members.sort(key=lambda r: (r.get("mtime") or 0, r["name"].lower()))
        out.append({"id": members[-1]["project_id"], "dir": p["dir"], "key": gk[1],
                    "members": members, "all": rows})
    return out


def _folder_reason(group: dict) -> str | None:
    """Why this song's folder can't be renamed, or None if it can."""
    d = group["dir"]
    others = [r for r in group["all"]
              if (_key(r["dir"]) == _key(d) or _under(r["path"], d))
              and song_key(r["name"]) != group["key"]]
    if others:
        return "Other songs are saved in this folder too, so it keeps its name."
    folder_key = song_key(re.sub(r"\s+project$", "", Path(d).name, flags=re.I))
    if folder_key != group["key"]:
        return "This folder isn't named after the song, so it keeps its name."
    for m in group["members"]:
        if _holds_full_addresses(Path(m["path"]), Path(d)):
            return ("This program remembers some samples in this folder by their full "
                    "address, so the folder keeps its name and they keep working.")
    return None


def _export_rows(catalog, member_ids: set[str]) -> list[dict]:
    with catalog._lock:
        rows = catalog.conn.execute(
            "SELECT path, project_id, name, mtime FROM exports WHERE hidden = 0").fetchall()
    out, seen = [], set()
    for r in sorted((dict(r) for r in rows), key=lambda r: (r.get("mtime") or 0, r["path"])):
        if r["project_id"] in member_ids and r["path"] not in seen and os.path.isfile(r["path"]):
            seen.add(r["path"])
            out.append(r)
    return out


def plan(catalog, project_ids: list[str], names: dict | None = None, style: str = "v",
         song_style: str = "paren", folder: bool = True, overrides: dict | None = None,
         skip: list[str] | None = None, numbers: str = "keep") -> dict:
    """What would be renamed, and to what. Changes nothing.

    numbers: "keep" the version numbers already in the names (filling gaps), or
    "order" to count 1, 2, 3 by save date. names: {group id: song name} to use
    instead of the suggestion. overrides:
    {current path: new name (no extension)} for single rows. skip: current paths
    to leave as they are."""
    names = names or {}
    overrides = {_key(k): v for k, v in (overrides or {}).items()}
    skipped = {_key(s) for s in (skip or [])}
    vfmt = VERSION_STYLES.get(style, VERSION_STYLES["v"])
    sfmt = SONG_STYLES.get(song_style, SONG_STYLES["paren"])
    uploaded = _uploaded(catalog)
    groups_out = []
    for g in _groups(catalog, project_ids):
        members = g["members"]
        suggested = _best_spelling([suggest_base(m["name"]) for m in reversed(members)])
        base = clean_name(names.get(g["id"]) or suggested) or suggested
        d = Path(g["dir"])

        # the folder
        f_reason = _folder_reason(g)
        f_name = d.name
        if f_reason is None:
            f_name = clean_name(overrides.get(_key(d))
                                or (f"{base} Project" if re.search(r"\sproject$", d.name, re.I) else base))
        f_row = {"kind": "folder", "old": str(d), "old_name": d.name, "new_name": f_name,
                 "status": "rename", "note": f_reason or ""}
        if f_reason:
            f_row["status"] = "kept"
        elif not folder or _key(d) in skipped:
            f_row.update(status="skipped", new_name=d.name)
        elif f_name == d.name:
            f_row["status"] = "same"
        elif os.path.lexists(d.parent / f_name) and not _same(d, d.parent / f_name):
            f_row.update(status="blocked", note=f"There's already a folder called \"{f_name}\" next to it.")
        moving = f_row["status"] == "rename"
        new_dir = d.parent / f_name if moving else d
        f_row["new"] = str(new_dir)
        if not moving:
            f_row["new_name"] = d.name

        rows = [f_row]
        taken: dict[str, str] = {}  # final path key -> row old path, to stop two rows landing on one name

        def place(old: Path, wanted: str, kind: str, extra: dict) -> dict:
            ext = old.suffix
            row = {"kind": kind, "old": str(old), "old_name": old.name, **extra}
            why = _keeps_own_name(old) if kind == "version" else None
            if why:
                row.update(status="kept", new_name=old.name, note=why)
            elif _key(old) in skipped:
                row.update(status="skipped", new_name=old.name, note="")
            else:
                stem = clean_name(overrides.get(_key(old)) or wanted) or old.stem
                new_name = stem + ext
                n = 2
                while kind == "song" and _final(old, d, new_dir, new_name) in taken:
                    new_name = f"{stem} {n}{ext}"
                    n += 1
                target = old.with_name(new_name)
                if new_name == old.name:
                    row.update(status="same", new_name=new_name, note="")
                elif _final(old, d, new_dir, new_name) in taken:
                    row.update(status="blocked", new_name=new_name,
                               note="Another file in this list would get the same name.")
                else:
                    row.update(status="rename", new_name=new_name, note="")
                    if os.path.lexists(target) and not _same(old, target):
                        row["_in_way"] = _key(target)  # fine if that file is renamed too
            row["new"] = str(Path(_final_path(old, d, new_dir, row["new_name"])))
            taken[_key(row["new"])] = row["old"]
            rows.append(row)
            return row

        # each saved version, oldest first
        vnames: dict[str, str] = {}
        many = len(members) > 1
        for i, m in zip(numbering(members, numbers != "order"), members):
            vname = vfmt.format(base=base, n=i) if many else base
            vnames[m["project_id"]] = vname
            place(Path(m["path"]), vname, "version",
                  {"version": i, "project_id": m["project_id"], "daw": m.get("daw")})

        # the songs exported from them
        names_by_id = {m["project_id"]: m["name"] for m in members}
        used, all_read = _used_files(members, d)
        for e in _export_rows(catalog, set(names_by_id)):
            vname = vnames[e["project_id"]]
            extra = _extra_words(Path(e["path"]).stem, names_by_id[e["project_id"]])
            wanted = sfmt.format(name=vname, extra=extra) if extra else vname
            info = {"project_id": e["project_id"], "uploaded": _key(e["path"]) in uploaded}
            if _key(e["path"]) in used or (not all_read and _under(e["path"], str(d))):
                old = Path(e["path"])
                rows.append({"kind": "song", "old": str(old), "old_name": old.name,
                             "new_name": old.name, "status": "kept", **info,
                             "new": _final_path(old, d, new_dir, old.name),
                             "note": "The project plays this file, so it keeps its name."})
                taken[_key(rows[-1]["new"])] = str(old)
                continue
            place(Path(e["path"]), wanted, "song", info)

        # A name that's taken now is fine when the file holding it gets a new name in
        # this same rename ("v2" -> "v1" frees "v2" for "FINAL 3"); otherwise blocked.
        changed = True
        while changed:
            changed = False
            leaving = {_key(r["old"]) for r in rows if r["status"] == "rename" and r["kind"] != "folder"}
            for r in rows:
                if r["status"] == "rename" and r.get("_in_way") and r["_in_way"] not in leaving:
                    r.update(status="blocked",
                             note=f"There's already a file called \"{r['new_name']}\" there.")
                    changed = True
        for r in rows:
            r.pop("_in_way", None)
        count = sum(1 for r in rows if r["status"] == "rename")
        groups_out.append({"id": g["id"], "name": base, "suggested": suggested, "folder": str(d),
                           "rows": rows, "count": count,
                           "versions": len(members),
                           "songs": sum(1 for r in rows if r["kind"] == "song")})
    return {"groups": groups_out, "count": sum(g["count"] for g in groups_out),
            "styles": {"version": list(VERSION_STYLES), "song": list(SONG_STYLES)}}


def _same(a: Path, b: Path) -> bool:
    """The same file under two spellings (a capital-letters-only rename on Mac/Windows)."""
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


def _final_path(old: Path, folder: Path, new_dir: Path, new_name: str) -> str:
    """Where a renamed file ends up once its folder has been renamed too."""
    parent = old.parent
    if new_dir != folder and (_key(parent) == _key(folder) or _under(str(parent), str(folder))):
        rel = os.path.relpath(parent, folder)
        parent = new_dir if rel == "." else new_dir / rel
    return str(parent / new_name)


def _final(old: Path, folder: Path, new_dir: Path, new_name: str) -> str:
    return _key(_final_path(old, folder, new_dir, new_name))


# ---- doing it -----------------------------------------------------------------
def apply(catalog, project_ids: list[str], **opts) -> dict:
    """Rename everything the plan says, record it for Undo, and move Backups' own
    records to the new names. All or nothing: if any rename fails, the ones already
    done are put back and nothing is recorded."""
    p = plan(catalog, project_ids, **opts)
    files: list[tuple[str, str]] = []
    folders: list[tuple[str, str]] = []
    file_map: dict[str, str] = {}
    dir_map: dict[str, str] = {}
    for g in p["groups"]:
        for r in g["rows"]:
            if r["status"] != "rename":
                continue
            old = Path(r["old"])
            if r["kind"] == "folder":
                folders.append((str(old), str(old.parent / r["new_name"])))
                dir_map[str(old)] = folders[-1][1]
            else:
                files.append((str(old), str(old.with_name(r["new_name"]))))
                file_map[r["old"]] = r["new"]
    if not files and not folders:
        raise TidyError("Nothing to rename: every name already matches.")
    _run(files, folders)  # files first, inside their old folders; then the folders
    batch_id = uuid.uuid4().hex[:12]
    at = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    id_map = move_records(catalog, file_map, dir_map)
    new_ids = sorted({id_map.get(pid, pid) for g in p["groups"] for m in g["rows"]
                      if (pid := m.get("project_id")) and m["kind"] == "version"})
    summary = ", ".join(g["name"] for g in p["groups"] if g["count"])
    with catalog._lock:
        catalog.conn.execute(
            "INSERT INTO tidy_batches (id, at, summary, project_ids, steps, file_map, dir_map, id_map) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (batch_id, at, summary, json.dumps(new_ids),
             json.dumps({"files": files, "folders": folders}),
             json.dumps(file_map), json.dumps(dir_map), json.dumps(id_map)))
        catalog.conn.executemany(
            "INSERT INTO renamed (old, new, kind, batch_id, at) VALUES (?, ?, ?, ?, ?)",
            [(o, n, "file", batch_id, at) for o, n in _resolved_pairs(file_map)]
            + [(o, n, "folder", batch_id, at) for o, n in _resolved_pairs(dir_map)]
            + [(o, n, "project", batch_id, at) for o, n in id_map.items()])
        catalog.conn.commit()
    return {"batch_id": batch_id, "renamed": len(files) + len(folders), "id_map": id_map,
            "summary": summary}


def _resolved_pairs(m: dict[str, str]) -> list[tuple[str, str]]:
    """Each old -> new pair as stored, plus the fully resolved spelling of the old one
    when it differs, so a reader holding either spelling can follow it."""
    out = []
    for o, n in m.items():
        out.append((o, n))
        ro, rn = os.path.realpath(o), os.path.realpath(n)
        if ro != o:
            out.append((ro, rn))
    return out


def _run(files: list[tuple[str, str]], folders: list[tuple[str, str]],
         folders_first: bool = False) -> None:
    """Rename files and folders; on any failure put back what was done and explain.

    Files go via a temporary name first, so names can be swapped or shifted along
    ("v2" -> "v1" while "FINAL 3" -> "v2") without one landing on another."""
    for src, dst in folders + files:
        if not os.path.lexists(src) and not folders_first:
            raise TidyError(f"\"{Path(src).name}\" isn't where it was. Nothing was renamed.")
    leaving = {_key(s) for s, _ in files}
    for src, dst in files if not folders_first else []:
        if os.path.lexists(dst) and not _same(Path(src), Path(dst)) and _key(dst) not in leaving:
            raise TidyError(f"There's already something called \"{Path(dst).name}\" there. "
                            "Nothing was renamed.")
    for src, dst in folders if not folders_first else []:
        if os.path.lexists(dst) and not _same(Path(src), Path(dst)):
            raise TidyError(f"There's already a folder called \"{Path(dst).name}\" there. "
                            "Nothing was renamed.")
    tag = uuid.uuid4().hex[:8]
    moves = [(src, str(Path(src).with_name(f".lc-tidy-{tag}-{i}{Path(src).suffix}")))
             for i, (src, _) in enumerate(files)]
    moves += [(tmp, dst) for (_, tmp), (_, dst) in zip(list(moves), files)]
    moves = (folders + moves) if folders_first else (moves + folders)
    done: list[tuple[str, str]] = []
    try:
        for src, dst in moves:
            # never replace anything: a name that's taken by now stops the whole rename
            if os.path.lexists(dst) and not _same(Path(src), Path(dst)):
                raise FileExistsError(17, "something with that name is already there")
            os.rename(src, dst)
            done.append((src, dst))
    except OSError as e:
        for a, b in reversed(done):
            try:
                os.rename(b, a)
            except OSError:
                pass
        raise TidyError(
            f"Couldn't rename \"{Path(src).name}\" ({e.strerror or e}). If it's open in your "
            "music program, close it and try again. Nothing was renamed.") from e


def last_batch(catalog, project_id: str) -> dict | None:
    """The most recent rename of this project that can still be undone."""
    with catalog._lock:
        rows = catalog.conn.execute(
            "SELECT id, at, summary, project_ids, steps FROM tidy_batches "
            "WHERE undone_at IS NULL ORDER BY at DESC").fetchall()
    for r in rows:
        if project_id in json.loads(r["project_ids"]):
            steps = json.loads(r["steps"])
            return {"id": r["id"], "at": r["at"], "summary": r["summary"],
                    "count": len(steps["files"]) + len(steps["folders"])}
    return None


def undo(catalog, batch_id: str) -> dict:
    """Put every name from one rename back, and Backups' records with them."""
    with catalog._lock:
        r = catalog.conn.execute("SELECT * FROM tidy_batches WHERE id = ?", (batch_id,)).fetchone()
    if r is None:
        raise TidyError("That rename isn't on record.")
    if r["undone_at"]:
        raise TidyError("Those names were already put back.")
    steps = json.loads(r["steps"])
    files = [(dst, src) for src, dst in steps["files"]]
    folders = [(dst, src) for src, dst in reversed(steps["folders"])]
    file_map = {v: k for k, v in json.loads(r["file_map"]).items()}
    dir_map = {v: k for k, v in json.loads(r["dir_map"]).items()}
    # everything must still be where the rename left it, and the old names free
    for now, before in list(file_map.items()) + list(dir_map.items()):
        if not os.path.lexists(now):
            raise TidyError(f"\"{Path(now).name}\" has been moved or renamed since, so the old "
                            "names can't be put back automatically. Nothing was changed.")
    for now, before in dir_map.items():
        if os.path.lexists(before) and not _same(Path(now), Path(before)):
            raise TidyError(f"There's a new \"{Path(before).name}\" in the way, so the old "
                            "names can't be put back automatically. Nothing was changed.")
    _run(files, folders, folders_first=True)
    id_map = move_records(catalog, file_map, dir_map)
    with catalog._lock:
        catalog.conn.execute("UPDATE tidy_batches SET undone_at = ? WHERE id = ?",
                             (datetime.now().strftime("%Y-%m-%d_%H%M%S"), batch_id))
        catalog.conn.execute("DELETE FROM renamed WHERE batch_id = ?", (batch_id,))
        catalog.conn.commit()
    return {"restored": len(files) + len(folders), "id_map": id_map}


# ---- Backups' own records ------------------------------------------------------
def move_records(catalog, file_map: dict[str, str], dir_map: dict[str, str]) -> dict[str, str]:
    """Point the catalog at the new names: the project list, each project's id (it
    comes from the file's location), its backups, its songs, and anything else
    keyed by project id. Returns {old id: new id}."""
    from ablebackup.scanner import project_id as make_id

    fm = {_key(k): v for k, v in file_map.items()}
    dm = [(_key(k), k, v) for k, v in dir_map.items()]

    def moved(p: str | None) -> str | None:
        if not p:
            return p
        k = _key(p)
        if k in fm:
            return fm[k]
        for dk, _, new in dm:
            if k == dk:
                return new
            if k.startswith(dk + os.sep):
                return os.path.join(new, os.path.relpath(k, dk))
        return p

    id_map: dict[str, str] = {}
    with catalog._lock:
        con = catalog.conn
        tables = [t for (t,) in con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()]
        with_ids = [t for t in tables if t != "discovered" and "project_id" in
                    {c["name"] for c in con.execute(f"PRAGMA table_info({t})")}]
        names = {}
        changes = []
        for d in [dict(x) for x in con.execute("SELECT project_id, name, path, dir FROM discovered")]:
            np, nd = moved(d["path"]), moved(d["dir"])
            if np == d["path"] and nd == d["dir"]:
                continue
            adapter = adapter_for_path(np)
            new_name = adapter.project_name(Path(np)) if adapter else Path(np).stem
            changes.append((d, make_id(Path(np)), new_name, np, nd))
        # Ids can swap places ("v2" becomes "v1" while "FINAL 3" becomes "v2"), so every
        # id goes to a temporary value first, then to its new one.
        changing = {d["project_id"] for d, *_ in changes}
        for d, new_id, *_ in changes:
            if new_id != d["project_id"]:
                id_map[d["project_id"]] = new_id
        for old in id_map:
            con.execute("UPDATE discovered SET project_id = ? WHERE project_id = ?", ("~" + old, old))
            for t in with_ids:
                con.execute(f"UPDATE {t} SET project_id = ? WHERE project_id = ?", ("~" + old, old))
        for d, new_id, new_name, np, nd in changes:
            cur = "~" + d["project_id"] if d["project_id"] in id_map else d["project_id"]
            if new_id not in changing:  # a stale row already holding the new id
                con.execute("DELETE FROM discovered WHERE project_id = ?", (new_id,))
            con.execute("UPDATE discovered SET project_id = ?, name = ?, path = ?, dir = ? "
                        "WHERE project_id = ?", (new_id, new_name, np, nd, cur))
            if new_name != d["name"]:
                names[new_id] = (d["name"], new_name, d["project_id"])
        for old, new in id_map.items():
            for t in with_ids:
                con.execute(f"UPDATE OR IGNORE {t} SET project_id = ? WHERE project_id = ?",
                            (new, "~" + old))
        # backups show under the new name; old unlabelled ones only if the name is unique
        all_names = [n for (n,) in con.execute("SELECT name FROM discovered")]
        for new_id, (old_name, new_name, old_id) in names.items():
            con.execute("UPDATE snapshots SET project_name = ? WHERE project_id = ?",
                        (new_name, new_id))
            if old_name not in all_names:
                con.execute("UPDATE snapshots SET project_name = ? "
                            "WHERE project_id IS NULL AND project_name = ?", (new_name, old_name))
        # songs: the file moved, so its record does too
        song_moves = []
        for e in [dict(x) for x in con.execute("SELECT rowid, path FROM exports")]:
            np = moved(e["path"])
            if np != e["path"]:
                song_moves.append((e["rowid"], ex._resolve(Path(np))))
        for rowid, _ in song_moves:  # via a temporary value, as names can swap
            con.execute("UPDATE exports SET path = ? WHERE rowid = ?", (f"~{rowid}", rowid))
        for rowid, rp in song_moves:
            con.execute("UPDATE OR IGNORE exports SET path = ?, name = ? WHERE rowid = ?",
                        (rp, Path(rp).stem, rowid))
        con.commit()
    return id_map


def follower(catalog):
    """A function giving a path's current spelling after any tidy renames
    (old song paths in Uploader's history, for instance)."""
    return follow_with(_renamed_rows(catalog, ("file", "folder")))


def id_follower(catalog):
    """The same for project ids (an id comes from the project file's location)."""
    return follow_with(_renamed_rows(catalog, ("project",)))


def _renamed_rows(catalog, kinds: tuple[str, ...]) -> list[dict]:
    try:
        with catalog._lock:
            rows = catalog.conn.execute(
                f"SELECT old, new, kind, batch_id FROM renamed WHERE kind IN "
                f"({','.join('?' * len(kinds))}) ORDER BY at, rowid", kinds).fetchall()
    except Exception:
        return []
    return [dict(r) for r in rows]


def follow_with(rows: list[dict]):
    """Follow renames batch by batch, oldest first. Within one rename each name moves
    once (so "v2" -> "v1" alongside "FINAL 3" -> "v2" doesn't chain into "v1")."""
    batches: list[tuple[dict, list]] = []
    current = None
    for r in rows:
        if current is None or r.get("batch_id") != current:
            current = r.get("batch_id")
            batches.append(({}, []))
        names, folders = batches[-1]
        if r["kind"] == "folder":
            folders.append((r["old"], r["new"]))
        else:
            names[r["old"]] = r["new"]

    def follow(p: str) -> str:
        if not p:
            return p
        for names, folders in batches:
            if p in names:
                p = names[p]
                continue
            for o, n in folders:
                if p.startswith(o + os.sep):
                    p = n + p[len(o):]
                    break
        return p

    return follow
