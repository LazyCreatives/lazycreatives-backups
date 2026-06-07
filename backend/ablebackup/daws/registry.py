"""Registry that maps project files (by extension) and stored daw ids to adapters."""
from pathlib import Path
from typing import Optional

from ablebackup.daws.ableton import AbletonAdapter
from ablebackup.daws.base import DawAdapter
from ablebackup.daws.flstudio import FlStudioAdapter

# New DAWs register by adding one adapter and one entry here — nothing else changes.
DAW_REGISTRY: list[DawAdapter] = [AbletonAdapter(), FlStudioAdapter()]

_BY_EXT = {ext.lower(): a for a in DAW_REGISTRY for ext in a.extensions}
_BY_ID = {a.daw_id: a for a in DAW_REGISTRY}


def adapter_for_path(path) -> Optional[DawAdapter]:
    return _BY_EXT.get(Path(path).suffix.lower())


def adapter_for_id(daw_id: str) -> Optional[DawAdapter]:
    return _BY_ID.get(daw_id)


def all_extensions() -> tuple[str, ...]:
    return tuple(_BY_EXT)
