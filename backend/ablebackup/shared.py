"""Share albums, Folders and project folders with your other computers.

Switched on in Settings ("Share with my other computers"), off until then. The
backup place (often a NAS) is the meeting point: each computer keeps one small file
of its own in "Lazy Creatives shared" there, and reads the others' files. Writing
only its own file means two computers never write the same file at once, which a
network drive handles badly. Because the file sits in the backup place, it's kept
with the backups too.

What's shared:
- albums: title, date, kind, crossfade and the songs in order;
- Folders (the ones you sort projects into);
- the project folders Backups looks in (Settings, Folders).

Each album or Folder goes as a whole, and the newest change wins. Taking one away
on one computer takes it away on the others, unless it was changed again later.
A song is kept by where it is on the computer that added it. Another computer looks
for the same file (same name and size) at the same place, in the same folders under
its own project folders, and among the songs Backups found; a song it can't find
stays on the album and shows "Not on this computer". A project folder only joins
this computer's list when it's there (a shared NAS folder is found at the place this
computer connects it). Nothing is ever copied, moved or changed except these lists.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath

from . import nas
from .albums import Albums
from .albums import elsewhere
from .folders import Folders
from .service import _is_rclone_remote

DIR_NAME = "Lazy Creatives shared"
SETTING = "shared"          # {"on": bool, "me": computer id}
KNOWN = "shared_known"      # what was shared last time, to tell a deletion from a new item
EVERY = 30.0                # seconds between looks while it's on
VERSION = 1
_GONE_KEEP = 180 * 86400    # how long a deletion is remembered (then forgotten)


def _now() -> float:
    return time.time()


def _norm(p: str) -> str:
    return os.path.normcase(os.path.normpath(p)) if p else ""


def _parts(p: str) -> tuple[str, ...]:
    """A path's parts, whichever computer wrote it."""
    if "\\" in p or (len(p) > 1 and p[1] == ":"):
        return PureWindowsPath(p).parts
    return PurePosixPath(p).parts


def _isfile(p: str, size=None) -> bool:
    try:
        return os.path.isfile(p) and (size is None or os.path.getsize(p) == size)
    except (OSError, ValueError):
        return False


def _write_json(path: Path, data: dict) -> None:
    """Write the whole file, then swap it in, so a reader never sees half of it."""
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


class Sharing:
    def __init__(self, catalog, albums: Albums | None = None, folders: Folders | None = None):
        self.catalog = catalog
        self.albums = albums or Albums()
        self.folders = folders or Folders()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.last: dict = {}    # what the last share did, for Settings
        self._wrote = ""        # what our file last said

    # ── the switch ─────────────────────────────────────────────────────────

    def _state(self) -> dict:
        s = self.catalog.get_setting(SETTING) or {}
        if not s.get("me"):
            s = {**s, "me": uuid.uuid4().hex}
            self.catalog.set_setting(SETTING, s)
        return s

    @property
    def on(self) -> bool:
        return bool(self._state().get("on"))

    def switch(self, on: bool) -> dict:
        self.catalog.set_setting(SETTING, {**self._state(), "on": bool(on)})
        if on:
            self.start()
            threading.Thread(target=self.share_now, daemon=True, name="share-first").start()
        return self.status()

    def place(self) -> Path | None:
        """The shared folder in the backup place ('' when there's no backup place, or
        it's a cloud account rather than a folder this computer can open)."""
        dest = (self.catalog.get_setting("config") or {}).get("dest", "")
        if not dest or _is_rclone_remote(dest):
            return None  # an rclone remote ("nas-sftp:/music") isn't a folder here
        return Path(dest) / DIR_NAME

    def status(self) -> dict:
        place = self.place()
        return {"on": self.on, "place": str(place) if place else "", **self.last}

    # ── running by itself ─────────────────────────────────────────────────

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="sharing")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(EVERY):
            if not self.on:
                return
            try:
                self.share_now()
            except Exception as e:  # never take the app down over a list
                self.last = {**self.last, "error": f"Couldn't share: {e}", "at": _now()}

    # ── one round ─────────────────────────────────────────────────────────

    def share_now(self) -> dict:
        """Read the other computers' files, take in what's newer, write ours."""
        with self._lock:
            if not self.on:
                return self.status()
            place = self.place()
            if place is None:
                self.last = {"error": "Pick a backup drive first (a drive, NAS or synced folder).", "at": _now()}
                return self.status()
            if not nas._quick_isdir(place.parent):
                # not a fault: an unplugged drive or a sleeping NAS, so it just waits
                self.last = {**self.last, "error": "", "waiting": "Your backup drive isn't connected right now. "
                                                                 "Sharing picks up again when it is."}
                return self.status()
            place.mkdir(exist_ok=True)
            me = self._state()["me"]
            others = self._read_others(place, me)
            mine = self._local()
            known = self.catalog.get_setting(KNOWN) or {}
            gone = self._gone(mine, known, others)
            took = self._take_in(mine, others, gone)
            if took:
                mine = self._local()
            out = {"v": VERSION, "computer": {"id": me, "name": socket.gethostname()}, **mine, "gone": gone}
            same = json.dumps(out, sort_keys=True, default=str)
            ours = place / f"{me}.json"
            if same != self._wrote or not ours.is_file():
                # only when something changed, so a sleeping NAS isn't written to every half minute
                _write_json(ours, {**out, "written_at": _now()})
                self._wrote = same
            self.catalog.set_setting(KNOWN, {
                "albums": [a["id"] for a in mine["albums"]],
                "folders": [f["id"] for f in mine["folders"]],
                "sources": [s for s in mine["sources"]]})
            self.last = {"at": _now(), "error": "", "waiting": "", "took": took,
                         "computers": sorted(o["computer"].get("name") or "Another computer" for o in others)}
            return self.status()

    def _read_others(self, place: Path, me: str) -> list[dict]:
        out = []
        try:
            files = sorted(place.glob("*.json"))
        except OSError:
            return out
        for f in files:
            if f.stem == me:
                continue
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue  # half-copied by a sync app, or not ours: try again next time
            if isinstance(d, dict) and d.get("v") == VERSION and isinstance(d.get("computer"), dict):
                out.append(d)
        return out

    # ── what this computer has ────────────────────────────────────────────

    def _local(self) -> dict:
        with self.albums._db() as con:
            albums = [dict(r) for r in con.execute("SELECT * FROM albums")]
            songs: dict[str, list[dict]] = {}
            for r in con.execute("SELECT * FROM album_songs ORDER BY album_id, pos"):
                d = dict(r)
                songs.setdefault(d.pop("album_id"), []).append(d)
        for a in albums:
            a["songs"] = [{**s, "name": _parts(s["path"])[-1] if s["path"] else ""} for s in songs.get(a["id"], [])]
            for s in a["songs"]:
                s.pop("pos", None)
        with self.folders._db() as con:
            folders = [dict(r) for r in con.execute("SELECT * FROM folders ORDER BY pos, created_at")]
            members: dict[str, list[dict]] = {}
            for r in con.execute("SELECT folder_id, project_id, added_at FROM folder_projects"):
                members.setdefault(r["folder_id"], []).append({"id": r["project_id"], "added_at": r["added_at"]})
        where = self._project_paths({m["id"] for ms in members.values() for m in ms})
        for f in folders:
            f["projects"] = [{**m, **where.get(m["id"], {})} for m in members.get(f["id"], [])]
        cfg = self.catalog.get_setting("config") or {}
        sources = [str(s) for s in cfg.get("sources") or [] if s]
        return {"albums": albums, "folders": folders, "sources": [self._portable(s) for s in sources]}

    def _project_paths(self, ids: set[str]) -> dict[str, dict]:
        if not ids:
            return {}
        out = {}
        with self.catalog._lock:
            for r in self.catalog.conn.execute("SELECT project_id, name, path, daw FROM discovered"):
                if r["project_id"] in ids:
                    out[r["project_id"]] = {"path": r["path"], "name": r["name"], "daw": r["daw"] or ""}
        return out

    def _portable(self, path: str) -> dict:
        """A project folder as other computers can find it: its path here, and the
        NAS shared folder it's in (they connect it at their own place)."""
        out = {"path": path}
        n = nas.remembered(self.catalog)
        hit = nas._share_for(n, path) if n else None
        if hit:
            share, mount = hit
            out["share"] = share
            out["rel"] = "/".join(Path(path).relative_to(mount).parts)
        return out

    # ── deletions ─────────────────────────────────────────────────────────

    def _gone(self, mine: dict, known: dict, others: list[dict]) -> dict:
        """Every deletion anyone made: {"albums": {id: when}, "folders": ..., "sources": {key: when}}.
        A deletion here is something shared last time that isn't here now."""
        now = _now()
        gone: dict[str, dict] = {"albums": {}, "folders": {}, "sources": {}}
        prev = (self.catalog.get_setting(SETTING) or {}).get("gone") or {}
        for kind in gone:
            for k, t in (prev.get(kind) or {}).items():
                gone[kind][k] = t
            for o in others:
                for k, t in ((o.get("gone") or {}).get(kind) or {}).items():
                    if isinstance(t, (int, float)):
                        gone[kind][k] = max(t, gone[kind].get(k, 0))
        have_a = {a["id"] for a in mine["albums"]}
        have_f = {f["id"] for f in mine["folders"]}
        have_s = {self._source_key(s) for s in mine["sources"]}
        for aid in known.get("albums") or []:
            if aid not in have_a and aid not in gone["albums"]:
                gone["albums"][aid] = now
        for fid in known.get("folders") or []:
            if fid not in have_f and fid not in gone["folders"]:
                gone["folders"][fid] = now
        for s in known.get("sources") or []:
            k = self._source_key(s)
            if k not in have_s and k not in gone["sources"]:
                gone["sources"][k] = now
        # a project folder added again here after it was taken away
        for k in have_s:
            if k in gone["sources"] and k not in {self._source_key(s) for s in known.get("sources") or []}:
                gone["sources"].pop(k)
        for kind in gone:
            gone[kind] = {k: t for k, t in gone[kind].items() if now - t < _GONE_KEEP}
        self.catalog.set_setting(SETTING, {**self._state(), "gone": gone})
        return gone

    @staticmethod
    def _source_key(s: dict) -> str:
        return f"nas:{s['share']}/{s.get('rel', '')}".lower() if s.get("share") else f"path:{_norm(s['path'])}"

    # ── taking in what's newer ────────────────────────────────────────────

    def _take_in(self, mine: dict, others: list[dict], gone: dict) -> int:
        took = 0
        took += self._albums_in(mine, others, gone["albums"])
        took += self._folders_in(mine, others, gone["folders"])
        took += self._sources_in(mine, others, gone["sources"])
        return took

    @staticmethod
    def _newest(others: list[dict], key: str) -> dict[str, dict]:
        best: dict[str, dict] = {}
        for o in others:
            for item in o.get(key) or []:
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                cur = best.get(item["id"])
                if cur is None or float(item.get("updated_at") or 0) > float(cur.get("updated_at") or 0):
                    best[item["id"]] = item
        return best

    def _albums_in(self, mine: dict, others: list[dict], gone: dict) -> int:
        here = {a["id"]: a for a in mine["albums"]}
        theirs = self._newest(others, "albums")
        drop = [aid for aid, t in gone.items() if aid in here and t > float(here[aid]["updated_at"]) - 0.5]
        put = []
        for aid, a in theirs.items():
            if aid in gone and gone[aid] >= float(a.get("updated_at") or 0) - 0.5:
                continue
            cur = here.get(aid)
            if cur is not None and float(a.get("updated_at") or 0) <= float(cur["updated_at"]) + 0.001:
                continue
            put.append((a, cur))
        if not drop and not put:
            return 0
        finder = _Finder(self)
        with self.albums._db(write=True) as con:
            for aid in drop:
                con.execute("DELETE FROM albums WHERE id = ?", (aid,))
            for a, cur in put:
                was = {(s["name"].lower(), s.get("size")): s["path"] for s in (cur or {}).get("songs", [])}
                con.execute("DELETE FROM albums WHERE id = ?", (a["id"],))
                con.execute("INSERT INTO albums(id, title, release_date, crossfade, kind, soundcloud, created_at, updated_at) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (a["id"], str(a.get("title") or "Untitled album"), str(a.get("release_date") or ""),
                             float(a.get("crossfade") or 0), str(a.get("kind") or ""), str(a.get("soundcloud") or ""),
                             float(a.get("created_at") or _now()), float(a.get("updated_at") or _now())))
                used = set()
                for i, s in enumerate(a.get("songs") or []):
                    if not isinstance(s, dict) or not s.get("path"):
                        continue
                    name = s.get("name") or _parts(s["path"])[-1]
                    path = was.get((name.lower(), s.get("size"))) or finder.find(s["path"], name, s.get("size"))
                    if path in used:
                        continue
                    used.add(path)
                    con.execute("INSERT INTO album_songs(album_id, pos, path, title, project, gapless_after, ready, genre, "
                                "added_at, size, mtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                                (a["id"], i, path, str(s.get("title") or name), str(s.get("project") or ""),
                                 int(bool(s.get("gapless_after"))), None if s.get("ready") is None else int(bool(s["ready"])),
                                 str(s.get("genre") or ""), float(s.get("added_at") or _now()),
                                 s.get("size"), s.get("mtime")))
        return len(drop) + len(put)

    def _folders_in(self, mine: dict, others: list[dict], gone: dict) -> int:
        here = {f["id"]: f for f in mine["folders"]}
        theirs = self._newest(others, "folders")
        drop = [fid for fid, t in gone.items() if fid in here and t > float(here[fid]["updated_at"]) - 0.5]
        put = []
        for fid, f in theirs.items():
            if fid in gone and gone[fid] >= float(f.get("updated_at") or 0) - 0.5:
                continue
            cur = here.get(fid)
            if cur is not None and float(f.get("updated_at") or 0) <= float(cur["updated_at"]) + 0.001:
                continue
            put.append(f)
        if not drop and not put:
            return 0
        ids = _ProjectIds(self.catalog)
        with self.folders._db(write=True) as con:
            for fid in drop:
                con.execute("DELETE FROM folders WHERE id = ?", (fid,))
            for f in put:
                pos = here[f["id"]]["pos"] if f["id"] in here else int(f.get("pos") or 0)
                con.execute("DELETE FROM folders WHERE id = ?", (f["id"],))
                con.execute("INSERT INTO folders(id, name, pos, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                            (f["id"], str(f.get("name") or "New folder")[:80], pos,
                             float(f.get("created_at") or _now()), float(f.get("updated_at") or _now())))
                for p in f.get("projects") or []:
                    if isinstance(p, dict) and p.get("id"):
                        con.execute("INSERT OR IGNORE INTO folder_projects(folder_id, project_id, added_at) VALUES (?, ?, ?)",
                                    (f["id"], ids.local(p), float(p.get("added_at") or _now())))
        return len(drop) + len(put)

    def _sources_in(self, mine: dict, others: list[dict], gone: dict) -> int:
        cfg = self.catalog.get_setting("config") or {}
        sources = [str(s) for s in cfg.get("sources") or [] if s]
        have = {self._source_key(s) for s in mine["sources"]}
        keep = [s for s in sources if self._source_key(self._portable(s)) not in gone]
        n = nas.remembered(self.catalog)
        added = []
        for o in others:
            for s in o.get("sources") or []:
                if not isinstance(s, dict) or not s.get("path"):
                    continue
                k = self._source_key(s)
                if k in have or k in gone:
                    continue
                here = None
                if s.get("share") and n:
                    mount = {n.get("share", ""): n.get("path", ""), **(n.get("shares") or {})}.get(s["share"])
                    if mount:
                        here = str(Path(mount, *[p for p in str(s.get("rel") or "").split("/") if p]))
                if here is None and not elsewhere(s["path"]):
                    here = s["path"]
                if here and nas._quick_isdir(Path(here)):
                    have.add(k)
                    added.append(here)
        if len(keep) == len(sources) and not added:
            return 0
        self.catalog.set_setting("config", {**cfg, "sources": keep + added})
        return len(sources) - len(keep) + len(added)


class _Finder:
    """Find a song from another computer on this one: same name and size."""

    def __init__(self, sharing: Sharing):
        self.s = sharing
        self._exports: dict[tuple, str] | None = None
        cfg = sharing.catalog.get_setting("config") or {}
        self.roots = [str(r) for r in cfg.get("sources") or [] if r]

    def find(self, path: str, name: str, size) -> str:
        if _isfile(path, size):
            return path
        parts = _parts(path)
        # the same folders under one of this computer's project folders (a NAS share,
        # a synced folder or a drive connected at another place)
        for root in self.roots:
            for k in range(2, min(len(parts), 8)):
                p = os.path.join(root, *parts[-k:])
                if _isfile(p, size):
                    return p
        if self._exports is None:
            self._exports = {}
            try:
                with self.s.catalog._lock:
                    rows = self.s.catalog.conn.execute("SELECT path, size FROM exports").fetchall()
                    rows += self.s.catalog.conn.execute("SELECT path, size FROM unmatched_exports").fetchall()
            except Exception:
                rows = []
            for r in rows:
                self._exports.setdefault((Path(r["path"]).name.lower(), r["size"]), r["path"])
        p = self._exports.get((name.lower(), size))
        if p and _isfile(p, size):
            return p
        return path  # not on this computer: kept, so it's found again if it turns up


class _ProjectIds:
    """A project on another computer, as this computer's id for it."""

    def __init__(self, catalog):
        with catalog._lock:
            rows = catalog.conn.execute("SELECT project_id, name, path, daw FROM discovered").fetchall()
        self.ids = {r["project_id"] for r in rows}
        self.by_path = {_norm(r["path"]): r["project_id"] for r in rows}
        self.by_tail: dict[tuple, str] = {}
        for r in rows:
            parts = _parts(r["path"])
            self.by_tail.setdefault(tuple(x.lower() for x in parts[-2:]), r["project_id"])

    def local(self, p: dict) -> str:
        if p["id"] in self.ids:
            return p["id"]
        path = str(p.get("path") or "")
        if path:
            hit = self.by_path.get(_norm(path)) or self.by_tail.get(tuple(x.lower() for x in _parts(path)[-2:]))
            if hit:
                return hit
        return p["id"]  # not on this computer: kept, so the Folder still holds it there

