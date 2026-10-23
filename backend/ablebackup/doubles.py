"""Same backup twice: backups of a project that hold exactly the same thing.

They pile up when a project that hadn't changed was backed up again with another
option (Copy as-is or Opens anywhere, another folder layout), each one a full copy.
Backups finds them, keeps the newest of each, and removes the others only when the
producer presses Remove. Only Backups' own copies are ever removed: a folder is
removed only when it is a backup Backups made (its manifest says so) inside the
current backup place. The producer's projects and songs are never touched.
"""
import json
import shutil
from pathlib import Path

from ablebackup import mirrors
from ablebackup.catalog import Catalog
from ablebackup.sorting import tidy_empty


def _read(d: str) -> dict | None:
    try:
        return json.loads((Path(d) / "manifest.json").read_text())
    except (OSError, ValueError):
        return None


def _content(m: dict):
    """What a backup holds: its files by name and content, and the project file on
    its own (Opens anywhere rewrites the project file, so that one can differ)."""
    files = [f for f in m.get("files") or [] if isinstance(f, dict)]
    proj = None
    if files:
        last = files[-1]
        if not last.get("export") and last.get("logical_path") == Path(last.get("source_path") or "").name:
            proj = last
            files = files[:-1]
    others = frozenset((f.get("logical_path"), f.get("digest")) for f in files)
    return others, (proj or {}).get("digest"), (proj or {}).get("source_path"), bool(m.get("portable"))


def _same(a, b) -> bool:
    others_a, proj_a, src_a, portable_a = a
    others_b, proj_b, src_b, portable_b = b
    if others_a != others_b or src_a != src_b:
        return False
    # The same project file, or the same project saved once as-is and once made to
    # open anywhere (that rewrite is the only difference between them).
    return proj_a == proj_b or portable_a != portable_b


def find(catalog: Catalog) -> dict:
    """{groups: [{project_name, keep, extras: [...]}], count, size}. Newest kept."""
    groups: dict[str, list] = {}
    for s in catalog.snapshots_here():
        groups.setdefault(s["project_id"] or s["project_name"], []).append(s)
    out = []
    count = size = 0
    for snaps in groups.values():
        if len(snaps) < 2:
            continue
        kept: list[tuple[dict, tuple]] = []
        found: dict[int, list] = {}
        for s in snaps:  # newest first
            m = _read(s["dir"])
            if not m or str(m.get("timestamp")) != s["timestamp"]:
                continue  # not readable, or not what the catalog says: leave it alone
            c = _content(m)
            match = next((k for k, kc in kept if _same(c, kc)), None)
            if match is None or s.get("label"):
                kept.append((s, c))  # a backup you named stays
                continue
            free = 0 if m.get("used_hardlinks") else int(s["total_size"] or 0)
            found.setdefault(match["id"], []).append({**_row(s), "frees": free})
            count += 1
            size += free
        for k, _c in kept:
            if k["id"] in found:
                out.append({"project_name": k["project_name"], "keep": _row(k), "extras": found[k["id"]]})
    out.sort(key=lambda g: g["project_name"].lower())
    return {"groups": out, "count": count, "size": size}


def _row(s: dict) -> dict:
    return {"id": s["id"], "timestamp": s["timestamp"], "dir": s["dir"], "size": int(s["total_size"] or 0)}


def remove(catalog: Catalog, ids: list[int] | None = None) -> dict:
    """Remove the extra copies (all, or just these ids, if they're still extras)."""
    dest = (catalog.get_setting("config") or {}).get("dest") or ""
    if not dest or not Path(dest).is_dir():
        return {"removed": 0, "failed": 0, "freed": 0}
    base = Path(dest)
    extras = [e for g in find(catalog)["groups"] for e in g["extras"]]
    if ids is not None:
        extras = [e for e in extras if e["id"] in set(ids)]
    removed, failed, freed, gone_ids, parents, gone = 0, 0, 0, [], [], []
    for e in extras:
        d = Path(e["dir"])
        if base not in d.parents or not (d / "manifest.json").is_file():
            failed += 1
            continue
        try:
            shutil.rmtree(d)
        except OSError:
            failed += 1
            continue
        removed += 1
        freed += e["frees"]
        gone_ids.append(e["id"])
        gone.append(str(d))
        parents.append(d.parent)
    catalog.delete_snapshots(gone_ids)
    tidy_empty(base, parents)
    mirrors.remove(catalog, base, gone)  # and from the Second copy
    return {"removed": removed, "failed": failed, "freed": freed}

