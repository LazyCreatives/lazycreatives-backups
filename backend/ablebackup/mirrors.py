"""The Second copy keeps the same folders as the backup drive.

Every backup is copied to the Second copy at the same place it has on the drive
(<second copy>/2024/House/Night Drive/<date>). When the sort moves the backups on
the drive, or Same backup twice removes extra copies, the same happens there, so
the two never drift apart. Only Backups' own copies are moved or removed.
"""
import os
import shutil
import subprocess
from pathlib import Path

from ablebackup.catalog import Catalog


def second_copies(catalog: Catalog) -> list[str]:
    return [m for m in (catalog.get_setting("config") or {}).get("mirrors") or [] if m]


def _remote(m: str) -> str | None:
    from ablebackup.service import _is_rclone_remote
    if not _is_rclone_remote(m):
        return None
    return (m[len("rclone:"):] if m.startswith("rclone:") else m).rstrip("/")


def _rclone(*args: str) -> bool:
    from ablebackup.service import rclone_path
    rc = rclone_path()
    if not rc:
        return False
    try:
        return subprocess.run([rc, *args, "--quiet"], capture_output=True, text=True,
                              timeout=3600).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _rel(base: Path, d: str) -> Path | None:
    try:
        return Path(d).relative_to(base)
    except ValueError:
        return None


def move(catalog: Catalog, base: Path, moves: list[dict]) -> int:
    """Move these backups ({old, new} on the drive) on every Second copy too. A copy
    that isn't there, or a place already taken, is left as it is. Returns failures."""
    from ablebackup.sorting import tidy_empty
    failed = 0
    for m in second_copies(catalog):
        remote = _remote(m)
        olds = []
        for mv in moves:
            old, new = _rel(base, mv["old"]), _rel(base, mv["new"])
            if old is None or new is None:
                continue
            if remote is not None:
                if not _rclone("moveto", f"{remote}/{old.as_posix()}", f"{remote}/{new.as_posix()}"):
                    failed += 1
                continue
            src, dst = Path(m) / old, Path(m) / new
            if not (src / "manifest.json").is_file() or dst.exists():
                continue
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                os.rename(src, dst)
                olds.append(src.parent)
            except OSError:
                failed += 1
        if remote is None and olds:
            tidy_empty(Path(m), olds)
    return failed


def remove(catalog: Catalog, base: Path, dirs: list[str]) -> None:
    """Remove these backups (folders on the drive) from every Second copy too."""
    from ablebackup.sorting import tidy_empty
    for m in second_copies(catalog):
        remote = _remote(m)
        gone = []
        for d in dirs:
            rel = _rel(base, d)
            if rel is None:
                continue
            if remote is not None:
                _rclone("purge", f"{remote}/{rel.as_posix()}")
                continue
            target = Path(m) / rel
            if (target / "manifest.json").is_file():
                try:
                    shutil.rmtree(target)
                    gone.append(target.parent)
                except OSError:
                    pass
        if remote is None and gone:
            tidy_empty(Path(m), gone)
