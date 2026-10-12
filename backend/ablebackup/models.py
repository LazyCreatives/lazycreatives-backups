from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Every DAW's tempo range sits inside 10–999 BPM (FL's is 10–522, Ableton's 20–999);
# a number outside it is a misread file, never a real tempo.
MIN_BPM, MAX_BPM = 10.0, 999.0


def plausible_bpm(value) -> Optional[float]:
    """The tempo if a project could really have it, else None (shown blank)."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if MIN_BPM <= v <= MAX_BPM else None


@dataclass
class FileRef:
    """A raw file reference extracted from an .als, before resolution."""
    name: str
    absolute_path: Optional[str] = None     # from <Path Value=.../>
    relative_path: Optional[str] = None     # POSIX-style, from <RelativePath .../>
    size: int = 0                           # from <OriginalFileSize/>, 0 if unknown
    # The DAW itself relinks a moved sample by file name alone (FL Studio does), so a
    # single same-named file in the searched folders is the one the DAW would load.
    name_match: bool = False


@dataclass
class ResolvedRef:
    """A file reference resolved against the filesystem."""
    name: str
    resolved_path: Optional[Path]
    exists: bool
    inside_project: bool
    size: int = 0
    mtime: float = 0.0
    relinked: bool = False                 # found in a library, not at its referenced path
    expected_path: Optional[str] = None   # relative path we looked for, when missing


@dataclass
class ProjectScan:
    """A discovered DAW project and its resolved dependencies."""
    project_path: Path                # the project file (.als, .flp, …)
    name: str
    project_dir: Path
    mtime: float
    size: int
    daw_id: str = "ableton"           # which DAW adapter owns this project
    project_id: str = ""              # stable identity; distinguishes same-named projects
    refs: list[ResolvedRef] = field(default_factory=list)
    tempo: float | None = None        # project BPM; feeds genre-guessing
    track_count: int | None = None    # content track/lane count (None if the format hides it)
    plugins: list[str] = field(default_factory=list)  # third-party plugin/instrument names used
    music_key: str | None = None      # the song's key ("C minor") where the format keeps it

    @property
    def als_path(self) -> Path:
        """Deprecated alias for project_path (kept during the multi-DAW migration)."""
        return self.project_path

    @property
    def missing(self) -> list[ResolvedRef]:
        return [r for r in self.refs if not r.exists]

    @property
    def total_size(self) -> int:
        return self.size + sum(r.size for r in self.refs if r.exists)
