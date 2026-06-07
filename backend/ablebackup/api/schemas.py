"""Pydantic wire models for the API."""
from pydantic import BaseModel


class Config(BaseModel):
    sources: list[str] = []
    dest: str = ""
    interval_minutes: int = 0  # 0 = scheduler disabled
    libraries: list[str] = []  # sample libraries to search for missing samples


class RestoreRequest(BaseModel):
    snapshot_id: int
    target: str  # folder to restore the project into


class ScanRequest(BaseModel):
    sources: list[str] | None = None  # falls back to saved config when omitted
    find_missing: bool = False        # relink missing samples from libraries


class BackupRequest(BaseModel):
    sources: list[str] | None = None
    dest: str | None = None
    timestamp: str | None = None
    als_paths: list[str] | None = None  # back up only these projects; None = all found
    label: str | None = None            # optional name saved with the snapshot
    portable: bool = False              # collect + rewrite so it opens anywhere
    layout: str = "project_date"        # on-disk organization: project_date | date_project
    find_missing: bool = False          # relink missing samples from libraries
