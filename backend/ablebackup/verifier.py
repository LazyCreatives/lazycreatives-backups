"""Verify a written snapshot against its manifest, so a user can trust a backup
actually contains every file — and, when asked, that the bytes still match."""
import json
from pathlib import Path

from ablebackup.daws.registry import adapter_for_id
from ablebackup.hashing import hash_file
from ablebackup.resolver import resolve_refs


def verify_snapshot(snapshot_dir, deep: bool = True) -> dict:
    """Check a snapshot folder against its manifest.json.

    Always checks every manifest file is present with the recorded size; when
    deep, also re-hashes each file and compares to the recorded digest (catches
    silent corruption / truncated NAS writes). Also reports whether the snapshot's
    own .als resolves all its samples from inside the snapshot (i.e. is portable).
    """
    snapshot_dir = Path(snapshot_dir)
    result = {
        "ok": False, "snapshot_dir": str(snapshot_dir), "deep": deep,
        "checked": 0, "present": 0, "missing_files": [], "bad_files": [],
        "portable_ok": None, "portable_missing": [], "relinked": [], "error": None,
    }
    manifest_path = snapshot_dir / "manifest.json"
    if not manifest_path.is_file():
        result["error"] = "manifest.json not found"
        return result
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, ValueError) as e:
        result["error"] = f"unreadable manifest: {e}"
        return result
    if "files" not in manifest:
        result["error"] = "snapshot predates file-level manifests — cannot verify"
        return result

    files = manifest["files"]
    result["checked"] = len(files)
    for f in files:
        p = snapshot_dir / f["logical_path"]
        try:
            size = p.stat().st_size if p.is_file() else None
        except OSError:
            size = None
        if size is None:
            result["missing_files"].append(f["logical_path"])
            continue
        if size != f.get("size"):
            result["bad_files"].append(f["logical_path"])
            continue
        if deep and hash_file(p) != f.get("digest"):
            result["bad_files"].append(f["logical_path"])
            continue
        result["present"] += 1
        if f.get("relinked"):
            result["relinked"].append({
                "logical_path": f["logical_path"], "source_path": f.get("source_path", ""),
            })

    # Portability: would this project open elsewhere using only the snapshot's files?
    # Re-parse via the adapter that wrote it (Ableton/.als, FL/.flp, …).
    adapter = adapter_for_id(manifest.get("daw", "ableton"))
    proj = None
    if adapter is not None:
        for ext in adapter.extensions:
            proj = next(iter(sorted(snapshot_dir.glob(f"*{ext}"))), None)
            if proj is not None:
                break
    if adapter is not None and proj is not None:
        try:
            refs = resolve_refs(adapter.parse_project(proj), snapshot_dir)
            unresolved = [r.expected_path or r.name for r in refs if not r.exists]
            result["portable_ok"] = len(unresolved) == 0
            result["portable_missing"] = unresolved
        except Exception:
            result["portable_ok"] = None

    result["ok"] = not result["missing_files"] and not result["bad_files"]
    return result
