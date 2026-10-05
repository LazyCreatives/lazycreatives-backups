"""Registry that maps project files (by extension) and stored daw ids to adapters."""
from pathlib import Path
from typing import Optional

from ablebackup.daws.ableton import AbletonAdapter
from ablebackup.daws.audacity import AudacityAdapter
from ablebackup.daws.base import DawAdapter
from ablebackup.daws.bitwig import BitwigAdapter
from ablebackup.daws.dawproject import DawprojectAdapter
from ablebackup.daws.flstudio import FlStudioAdapter
from ablebackup.daws.logic import LogicAdapter
from ablebackup.daws.reaper import ReaperAdapter
from ablebackup.daws.studioone import StudioOneAdapter

# New DAWs register by adding one adapter and one entry here — nothing else changes.
DAW_REGISTRY: list[DawAdapter] = [
    AbletonAdapter(), FlStudioAdapter(), ReaperAdapter(), DawprojectAdapter(),
    AudacityAdapter(), LogicAdapter(), StudioOneAdapter(), BitwigAdapter(),
]

_BY_EXT = {ext.lower(): a for a in DAW_REGISTRY for ext in a.extensions}
_BY_ID = {a.daw_id: a for a in DAW_REGISTRY}


def adapter_for_path(path) -> Optional[DawAdapter]:
    return _BY_EXT.get(Path(path).suffix.lower())


def adapter_for_id(daw_id: str) -> Optional[DawAdapter]:
    return _BY_ID.get(daw_id)


def package_extensions() -> tuple[str, ...]:
    """Extensions of projects that are folders (macOS packages such as Logic's
    .logicx): discovery matches these on folder names and never walks inside."""
    return tuple(e.lower() for a in DAW_REGISTRY for e in getattr(a, "package_extensions", ()))


def ignored_file(path) -> bool:
    """A file with a project extension that its program says is not a project of its
    own (Studio One's autosaves and saved versions in a song's History folder, Bitwig's
    auto-backups)."""
    a = adapter_for_path(path)
    fn = getattr(a, "ignore_file", None) if a else None
    return bool(fn and fn(path))


def all_extensions() -> tuple[str, ...]:
    return tuple(_BY_EXT)
