"""FL Studio adapter — uses the clean-room .flp reader (no PyFLP, no GPL).

FL doesn't record a per-sample size, so FileRef.size stays 0 and the resolver
falls back to its path-tail relink heuristic. An unreadable project raises and is
skipped by the scanner rather than crashing the whole scan.
"""
import os
from pathlib import Path
from typing import Optional

from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.daws.flp import read_all, read_sample_paths, rewrite_sample_paths
from ablebackup.models import FileRef
from ablebackup.resolver import basename, first_existing, is_unc

SKIP_DIRS = COMMON_SKIP


def _is_abs(p: str) -> bool:
    # Drive paths (C:\\...) and network-share paths (\\\\PC\\Share\\...) are absolute
    # whichever computer reads the project.
    return os.path.isabs(p) or (len(p) > 1 and p[1] == ":") or is_unc(p)


def _to_ref(s: str) -> FileRef:
    # Relative paths (incl. our portable rewrite's "_External/x.wav") resolve
    # against the .flp's folder — same convention as Reaper/DAWproject. FL relinks a
    # moved sample by file name, so the resolver may too (name_match).
    if _is_abs(s):
        return FileRef(name=basename(s), absolute_path=s, name_match=True)
    return FileRef(name=basename(s), relative_path=s, name_match=True)


class FlStudioAdapter:
    daw_id = "flstudio"
    display_name = "FL Studio"
    extensions = (".flp",)
    backup_root = "FLStudioBackups"

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return walk_for_extensions(roots, self.extensions, self.skip_dirs())

    def parse_project(self, project_path: Path) -> list[FileRef]:
        return [_to_ref(s) for s in read_sample_paths(project_path)]

    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]:
        paths, meta = read_all(project_path)
        return [_to_ref(s) for s in paths], meta

    def rewrite_portable(self, project_path: Path,
                         placement: Optional[dict] = None) -> Optional[bytes]:
        """An .flp whose EXTERNAL sample paths point at their collected copies in
        the snapshot (relative to the .flp — FL resolves those against the project's
        folder and auto-searches it for strays). Missing samples are left untouched
        for the verifier to report. Returns None when nothing was rewritten."""
        placement = placement or {}
        project_dir = Path(project_path).parent

        def mapper(s: str) -> Optional[str]:
            cand, _ = first_existing(_to_ref(s), project_dir)
            if cand is None:
                return None
            try:
                cand.resolve().relative_to(project_dir.resolve())
                return None        # already inside the project folder — leave it
            except ValueError:
                return placement.get(str(cand)) or f"_External/{cand.name}"

        return rewrite_sample_paths(project_path, mapper)

    def project_name(self, project_path: Path) -> str:
        return project_path.stem

    def skip_dirs(self) -> set[str]:
        return set(SKIP_DIRS)

    def default_libraries(self) -> list[Path]:
        return []  # FL packs live alongside the install; no reliable shared library
