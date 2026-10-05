"""Pydantic wire models for the API. Bounded to reject hostile/oversized input."""
from pydantic import BaseModel, Field

_PATH = 4096   # max chars for a path-ish string
_LIST = 5000   # max items in a path list


class Config(BaseModel):
    sources: list[str] = Field(default_factory=list, max_length=_LIST)
    dest: str = Field("", max_length=_PATH)
    interval_minutes: int = Field(0, ge=0, le=44640)  # 0 = off … max 31 days
    libraries: list[str] = Field(default_factory=list, max_length=_LIST)
    mirrors: list[str] = Field(default_factory=list, max_length=100)  # offsite/cloud dests


class RestoreRequest(BaseModel):
    snapshot_id: int = Field(..., ge=0)
    target: str = Field(..., max_length=_PATH)  # folder to restore/share into


class ActivateRequest(BaseModel):
    key: str = Field(..., max_length=200)  # license key from checkout


class CloudConnectRequest(BaseModel):
    provider: str = Field(..., max_length=32)        # e.g. "drive"
    name: str | None = Field(None, max_length=64)    # rclone remote name; defaults per provider


class CloudDisconnectRequest(BaseModel):
    name: str = Field(..., max_length=64)            # rclone remote name to forget


class ScanRequest(BaseModel):
    sources: list[str] | None = Field(None, max_length=_LIST)  # falls back to saved config
    find_missing: bool = False        # relink missing samples from libraries
    scope: str | None = Field(None, max_length=16)  # sources|home|volumes


class ExportLinkRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=_PATH)
    project_id: str = Field(..., min_length=1, max_length=128)


class ExportIgnoreRequest(BaseModel):
    path: str = Field(..., min_length=1, max_length=_PATH)
    ignored: bool = True


class GenreRequest(BaseModel):
    project_ids: list[str] = Field(..., min_length=1, max_length=_LIST)
    genre: str | None = Field(None, max_length=40)  # None: go back to the guess


class ExportFoldersRequest(BaseModel):
    folders: list[str] = Field(default_factory=list, max_length=_LIST)
    # Folders Backups found on its own that the user said not to look in. None = unchanged.
    ignored: list[str] | None = Field(default=None, max_length=_LIST)


class BackupRequest(BaseModel):
    sources: list[str] | None = Field(None, max_length=_LIST)
    dest: str | None = Field(None, max_length=_PATH)
    timestamp: str | None = Field(None, max_length=64)
    als_paths: list[str] | None = Field(None, max_length=_LIST)  # back up only these; None = all
    label: str | None = Field(None, max_length=200)             # optional name on the snapshot
    portable: bool = False              # collect + rewrite so it opens anywhere
    layout: str = Field("project_date", max_length=32)  # project_date | date_project
    find_missing: bool = False          # relink missing samples from libraries
    libraries: list[str] | None = Field(None, max_length=_LIST)  # one-off folders to also search this run (merged with saved libraries)
    relink_map: dict[str, str] | None = Field(None)  # exact per-file remaps {missing expected_path -> chosen file} the user pointed at


class TidyRequest(BaseModel):
    """Tidy names: the projects picked, and how the person wants them named."""
    project_ids: list[str] = Field(..., min_length=1, max_length=500)
    names: dict[str, str] | None = Field(None)       # {group id: song name}
    style: str = Field("v", max_length=8)             # v | v0
    numbers: str = Field("keep", max_length=8)        # keep | order
    song_style: str = Field("paren", max_length=8)    # paren | dash
    folder: bool = True                               # rename the project folder too
    overrides: dict[str, str] | None = Field(None)    # {current path: new name}
    skip: list[str] | None = Field(None, max_length=_LIST)  # current paths to leave alone


class TidyUndoRequest(BaseModel):
    batch_id: str = Field(..., min_length=1, max_length=64)
