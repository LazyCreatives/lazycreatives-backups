"""Reaper adapter — .rpp is plain text, so this is the cheapest adapter to add
and a good proof that the registry seam holds across very different formats.

Audio sources live in `<SOURCE …>` blocks as a `FILE "path"` line (paths may be
relative to the .rpp or absolute; Reaper quotes with ", ' or backtick).
"""
import os
import re
from pathlib import Path
from typing import Optional

from ablebackup.daws.base import COMMON_SKIP, walk_for_extensions
from ablebackup.models import FileRef

_AUDIO_EXTS = (".wav", ".aif", ".aiff", ".flac", ".mp3", ".ogg", ".m4a", ".wv", ".aac")
_FILE_LINE = re.compile(r"^\s*FILE\s+(.+?)\s*$")  # ^FILE only — not RENDER_FILE
_TEMPO_LINE = re.compile(r"^\s*TEMPO\s+([0-9.]+)")
_TRACK_LINE = re.compile(r"^\s*<TRACK\b")
# FX block opener: <VST "VST3: Pro-Q 3 (FabFilter)" …  /  <AU "AU: …" /  <CLAP / <DX / <LV2
_FX_LINE = re.compile(r'^\s*<(?:VST|AU|CLAP|DX|LV2)\s+"([^"]+)"')
# the quoted name carries a format prefix ("VST3:", "VSTi:", "AUi:", …) — drop it
_FX_PREFIX = re.compile(r"^(?:VST3?i?|AUi?|CLAPi?|DXi?|LV2i?|JSi?):\s*")


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


def read_meta(rpp_path) -> dict:
    """Display metadata from a .rpp: master tempo (the first project-level TEMPO
    line), track count (<TRACK blocks), and plugin names from FX-chain openers
    (format prefixes like "VST3:" stripped, trailing "(Vendor)" kept)."""
    tempo: float | None = None
    tracks = 0
    plugins: list[str] = []
    seen: set[str] = set()
    for line in Path(rpp_path).read_text(errors="ignore").splitlines():
        if tempo is None:
            m = _TEMPO_LINE.match(line)
            if m:
                try:
                    tempo = float(m.group(1))
                except ValueError:
                    pass
                continue
        if _TRACK_LINE.match(line):
            tracks += 1
            continue
        m = _FX_LINE.match(line)
        if m:
            name = _FX_PREFIX.sub("", m.group(1)).strip()
            if name and name not in seen:
                seen.add(name)
                plugins.append(name)
    return {"tempo": tempo, "tracks": tracks or None, "plugins": plugins}


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

    def parse_with_meta(self, project_path: Path) -> tuple[list[FileRef], dict]:
        return self.parse_project(project_path), read_meta(project_path)

    def rewrite_portable(self, project_path: Path,
                         placement: Optional[dict] = None) -> Optional[bytes]:
        """A .rpp whose EXTERNAL `FILE "path"` lines point at their collected copies
        inside the snapshot (Reaper resolves relative paths against the .rpp folder).
        `placement` maps str(source path) -> stored logical path; falls back to
        _External/<name>. Returns None when nothing external is referenced."""
        placement = placement or {}
        project_dir = Path(project_path).parent
        out_lines: list[str] = []
        changed = False
        text = Path(project_path).read_text(errors="ignore")
        for line in text.splitlines(keepends=True):
            m = _FILE_LINE.match(line)
            if m:
                p = _unquote(m.group(1).strip())
                if p and p.lower().endswith(_AUDIO_EXTS):
                    # join exactly as the resolver does, so placement keys match
                    cand = Path(p) if os.path.isabs(p) or (len(p) > 1 and p[1] == ":") \
                        else project_dir / Path(p.replace("\\", "/"))
                    if cand.is_file():
                        try:
                            cand.resolve().relative_to(project_dir.resolve())
                        except ValueError:  # external — repoint at the collected copy
                            new = placement.get(str(cand)) or f"_External/{cand.name}"
                            line = line.replace(m.group(1), f'"{new}"', 1)
                            changed = True
            out_lines.append(line)
        if not changed:
            return None
        return "".join(out_lines).encode("utf-8")

    def project_name(self, project_path: Path) -> str:
        return project_path.stem

    def skip_dirs(self) -> set[str]:
        return set(COMMON_SKIP)

    def default_libraries(self) -> list[Path]:
        return []
