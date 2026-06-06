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


def backup_project(scan: ProjectScan, dest_root: Path, timestamp: str) -> BackupResult:
    """Write one project to dest_root as a deduplicated dated snapshot."""
    pool = dest_root / "_pool"
    use_hardlinks = supports_hardlinks(dest_root)
    final_dir = dest_root / "projects" / scan.name / timestamp
    temp_dir = dest_root / "projects" / scan.name / f".{timestamp}.tmp"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)

    total_size = 0
    file_count = 0
    missing: list[str] = []
    placed: dict[str, str] = {}  # logical path -> file digest, to handle collisions

    # The .als itself.
    als_digest = hash_file(scan.als_path)
    total_size += _place(pool, scan.als_path, temp_dir / scan.als_path.name,
                         use_hardlinks, als_digest)
    placed[scan.als_path.name] = als_digest
    file_count += 1

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
        total_size += _place(pool, ref.resolved_path, temp_dir / logical,
                             use_hardlinks, digest)
        placed[logical] = digest
        file_count += 1

    manifest = {
        "project_name": scan.name,
        "timestamp": timestamp,
        "file_count": file_count,
        "total_size": total_size,
        "missing": missing,
        "used_hardlinks": use_hardlinks,
    }
    (temp_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    if final_dir.exists():
        shutil.rmtree(final_dir)
    temp_dir.rename(final_dir)

    return BackupResult(
        project_name=scan.name,
        timestamp=timestamp,
        snapshot_dir=final_dir,
        file_count=file_count,
        total_size=total_size,
        missing=missing,
    )
