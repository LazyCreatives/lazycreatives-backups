"""Reaper adapter — .rpp is plain text, so this is the cheapest adapter to add
and a good proof that the registry seam holds across very different formats.

Audio sources live in `<SOURCE …>` blocks as a `FILE "path"` line (paths may be
relative to the .rpp or absolute; Reaper quotes with ", ' or backtick).
"""
import os
import re
from pathlib import Path

from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.models import FileRef

_AUDIO_EXTS = (".wav", ".aif", ".aiff", ".flac", ".mp3", ".ogg", ".m4a", ".wv", ".aac")
_FILE_LINE = re.compile(r"^\s*FILE\s+(.+?)\s*$")  # ^FILE only — not RENDER_FILE


def _unquote(s: str) -> str:
    if len(s) >= 2 and s[0] in "\"'`" and s[-1] == s[0]:
        return s[1:-1]
    return s


def read_sample_paths(rpp_path) -> list[str]:
    """Audio source paths referenced by a .rpp project (deduped)."""
    out: list[str] = []
    seen: set[str] = set()
    for line in Path(rpp_path).read_text(errors="ignore").splitlines():
        m = _FILE_LINE.match(line)
        if not m:
            continue
        p = _unquote(m.group(1).strip())
        if p and p.lower().endswith(_AUDIO_EXTS) and p not in seen:
            seen.add(p)
            out.append(p)
    return out


class ReaperAdapter:
    daw_id = "reaper"
    display_name = "Reaper"
    extensions = (".rpp",)
    backup_root = "ReaperBackups"

    def discover_projects(self, roots: list[Path]) -> list[Path]:
        return walk_for_extensions(roots, self.extensions, self.skip_dirs())

    def parse_project(self, project_path: Path) -> list[FileRef]:
        refs: list[FileRef] = []
        for p in read_sample_paths(project_path):
            # Windows drive letters and POSIX roots are absolute; the rest are
            # relative to the .rpp folder (the resolver handles both).
            if os.path.isabs(p) or (len(p) > 1 and p[1] == ":"):
                refs.append(FileRef(name=Path(p).name, absolute_path=p))
            else:
                refs.append(FileRef(name=Path(p).name, relative_path=p))
        return refs

    def project_name(self, project_path: Path) -> str:
        return project_path.stem

    def skip_dirs(self) -> set[str]:
        return set(COMMON_SKIP)

    def default_libraries(self) -> list[Path]:
        return []
