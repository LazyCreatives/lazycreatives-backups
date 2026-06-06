"""Pydantic wire models for the API."""
from pydantic import BaseModel


class Config(BaseModel):
    sources: list[str] = []
    dest: str = ""
    interval_minutes: int = 0  # 0 = scheduler disabled


class ScanRequest(BaseModel):
    sources: list[str] | None = None  # falls back to saved config when omitted


class BackupRequest(BaseModel):
    sources: list[str] | None = None
    dest: str | None = None
    timestamp: str | None = None
