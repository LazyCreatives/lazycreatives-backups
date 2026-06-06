from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class FileRef:
    """A raw file reference extracted from an .als, before resolution."""
    name: str
    absolute_path: Optional[str] = None     # from <Path Value=.../>
    relative_path: Optional[str] = None     # POSIX-style, from <RelativePath .../>


@dataclass
class ResolvedRef:
    """A file reference resolved against the filesystem."""
    name: str
    resolved_path: Optional[Path]
    exists: bool
    inside_project: bool
    size: int = 0


@dataclass
class ProjectScan:
    """A discovered Ableton project and its resolved dependencies."""
    als_path: Path
    name: str
    project_dir: Path
    mtime: float
    size: int
    refs: list[ResolvedRef] = field(default_factory=list)

    @property
    def missing(self) -> list[ResolvedRef]:
        return [r for r in self.refs if not r.exists]

    @property
    def total_size(self) -> int:
        return self.size + sum(r.size for r in self.refs if r.exists)
