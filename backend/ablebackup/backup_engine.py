"""Backup engine: pooled, hardlinked, atomic project snapshots."""
import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from ablebackup.hashing import hash_file
from ablebackup.models import ProjectScan


def supports_hardlinks(dest_dir: Path) -> bool:
    """Probe whether the destination filesystem supports hardlinks."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    src = dest_dir / ".hardlink_probe_src"
    dst = dest_dir / ".hardlink_probe_dst"
    try:
        src.write_bytes(b"probe")
        os.link(src, dst)
        return True
    except (OSError, NotImplementedError):
        return False
    finally:
        for p in (dst, src):
            try:
                p.unlink()
            except OSError:
                pass


@dataclass
class BackupResult:
    project_name: str
    timestamp: str
    snapshot_dir: Path
    file_count: int
    total_size: int
    missing: list[str]
    relinked_count: int = 0


def _logical_path(scan: ProjectScan, ref) -> str:
    """Path of a resolved ref inside the snapshot folder (POSIX-style)."""
    if ref.inside_project:
        rel = ref.resolved_path.resolve().relative_to(scan.project_dir.resolve())
        return rel.as_posix()
    return f"_External/{ref.name}"


def _place(pool: Path, src: Path, dest_file: Path, use_hardlinks: bool, digest: str) -> int:
    """Store src in the pool under its digest and link/copy it to dest_file. Returns size."""
    pooled = pool / digest[:2] / digest
    if not pooled.exists():
        pooled.parent.mkdir(parents=True, exist_ok=True)
        tmp = pooled.with_name(f"{pooled.name}.{os.getpid()}.tmp")
        shutil.copy2(src, tmp)
        os.replace(tmp, pooled)  # atomic on same filesystem; no partial final file
    dest_file.parent.mkdir(parents=True, exist_ok=True)
    if use_hardlinks:
        os.link(pooled, dest_file)
    else:
        shutil.copy2(pooled, dest_file)
    return pooled.stat().st_size


def _disambiguate(logical: str, digest: str) -> str:
    """Insert a short hash before the suffix so different files don't collide."""
    p = Path(logical)
    return p.with_name(f"{p.stem}.{digest[:8]}{p.suffix}").as_posix()


def _claimed_folder(parent: Path, name: str, project_id: str) -> Path:
    """A folder under `parent` reserved for this project_id. If a DIFFERENT project
    already claimed the plain name (marked with .abid), this project gets a short
    id-suffixed folder, so two same-named projects never share/overwrite storage."""
    parent.mkdir(parents=True, exist_ok=True)
    folder = parent / name
    marker = folder / ".abid"
    if project_id and folder.exists() and marker.is_file() \
            and marker.read_text().strip() != project_id:
        folder = parent / f"{name} ({project_id[:6]})"
    return folder


def backup_project(scan: ProjectScan, dest_root: Path, timestamp: str,
                   portable: bool = False, layout: str = "project_date") -> BackupResult:
    """Write one project to dest_root as a deduplicated dated snapshot."""
    pool = dest_root / "_pool"
    use_hardlinks = supports_hardlinks(dest_root)
    if layout == "date_project":
        claim_dir = _claimed_folder(dest_root / "by-date" / timestamp, scan.name, scan.project_id)
        final_dir = claim_dir
    else:
        claim_dir = _claimed_folder(dest_root / "projects", scan.name, scan.project_id)
        final_dir = claim_dir / timestamp
    temp_dir = final_dir.parent / f".{final_dir.name}.tmp"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)

    total_size = 0
    missing: list[str] = []
    placed: dict[str, str] = {}  # logical path -> file digest, to handle collisions
    files: list[dict] = []       # per-file manifest entries, for later verification

    def record(logical, digest, size, source, inside, relinked):
        files.append({
            "logical_path": logical, "digest": digest, "size": size,
            "source_path": source, "inside_project": inside, "relinked": relinked,
        })

    # The .als itself.
    als_digest = hash_file(scan.als_path)
    sz = _place(pool, scan.als_path, temp_dir / scan.als_path.name, use_hardlinks, als_digest)
    total_size += sz
    placed[scan.als_path.name] = als_digest
    record(scan.als_path.name, als_digest, sz, str(scan.als_path), True, False)

    # Each resolved reference.
    for ref in scan.refs:
        if not ref.exists or ref.resolved_path is None:
            missing.append(ref.expected_path or ref.name)
            continue
        logical = _logical_path(scan, ref)
        digest = hash_file(ref.resolved_path)
        existing = placed.get(logical)
        if existing is not None:
            if existing == digest:
                continue  # identical file already placed (e.g. sample reused across clips)
            logical = _disambiguate(logical, digest)
            if placed.get(logical) == digest:
                continue  # this exact different-content file already disambiguated+placed
        sz = _place(pool, ref.resolved_path, temp_dir / logical, use_hardlinks, digest)
        total_size += sz
        placed[logical] = digest
        record(logical, digest, sz, str(ref.resolved_path), ref.inside_project, ref.relinked)

    file_count = len(files)
    relinked_count = sum(1 for f in files if f["relinked"])
    manifest = {
        "project_name": scan.name,
        "timestamp": timestamp,
        "file_count": file_count,
        "total_size": total_size,
        "missing": missing,
        "used_hardlinks": use_hardlinks,
        "portable": portable,
        "layout": layout,
        "files": files,
    }
    (temp_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    if final_dir.exists():
        shutil.rmtree(final_dir)
    temp_dir.rename(final_dir)
    # Reserve this folder for this project so a different same-named project can't reuse it.
    if scan.project_id:
        claim_dir.mkdir(parents=True, exist_ok=True)
        (claim_dir / ".abid").write_text(scan.project_id)

    return BackupResult(
        project_name=scan.name,
        timestamp=timestamp,
        snapshot_dir=final_dir,
        file_count=file_count,
        total_size=total_size,
        missing=missing,
        relinked_count=relinked_count,
    )
