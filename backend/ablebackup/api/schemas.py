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


class ScanRequest(BaseModel):
    sources: list[str] | None = Field(None, max_length=_LIST)  # falls back to saved config
    find_missing: bool = False        # relink missing samples from libraries


class BackupRequest(BaseModel):
    sources: list[str] | None = Field(None, max_length=_LIST)
    dest: str | None = Field(None, max_length=_PATH)
    timestamp: str | None = Field(None, max_length=64)
    als_paths: list[str] | None = Field(None, max_length=_LIST)  # back up only these; None = all
    label: str | None = Field(None, max_length=200)             # optional name on the snapshot
    portable: bool = False              # collect + rewrite so it opens anywhere
    layout: str = Field("project_date", max_length=32)  # project_date | date_project
    find_missing: bool = False          # relink missing samples from libraries
