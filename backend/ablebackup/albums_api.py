"""The /api/albums routes, the same in both apps.

SHARED FILE: the same file lives in Backups (backend/ablebackup/albums_api.py) and
Uploader (backend/lazyupload/albums_api.py). Keep the two byte-identical.

Each app passes in what only it knows: its sign-in check, where Backups keeps its
records, and the songs it can offer for an album.
"""
import asyncio
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .albums import Albums, NotFound, judge_album

_PATH = 4096


class AlbumCreate(BaseModel):
    title: str = Field("", max_length=200)
    release_date: str = Field("", max_length=10)


class AlbumUpdate(BaseModel):
    title: str | None = Field(None, max_length=200)
    release_date: str | None = Field(None, max_length=10)
    crossfade: float | None = Field(None, ge=0, le=12)


class AlbumSongIn(BaseModel):
    path: str = Field(..., min_length=1, max_length=_PATH)
    title: str = Field("", max_length=300)
    project: str = Field("", max_length=300)


class AlbumAdd(BaseModel):
    songs: list[AlbumSongIn] = Field(..., min_length=1, max_length=500)


class AlbumOrder(BaseModel):
    paths: list[str] = Field(..., max_length=500)


class AlbumSongChange(BaseModel):
    path: str = Field(..., min_length=1, max_length=_PATH)
    title: str | None = Field(None, max_length=300)
    gapless_after: bool | None = None
    ready: bool | None = None
    clear_ready: bool = False   # go back to letting the app judge


def make_router(auth, backups_db: Callable[[], Path | None],
                candidates: Callable[[], list[dict]], store: Albums | None = None) -> APIRouter:
    albums = store or Albums()
    r = APIRouter(dependencies=[Depends(auth)])

    def judged(a: dict) -> dict:
        return judge_album(a, backups_db())

    def run(fn, *args, **kw):
        try:
            return judged(fn(*args, **kw))
        except NotFound:
            raise HTTPException(status_code=404, detail="That album or song isn't there any more") from None

    @r.get("/api/albums")
    async def list_albums():
        def go():
            db = backups_db()
            return {"rev": albums.rev(), "albums": [judge_album(a, db) for a in albums.all()]}
        return await asyncio.to_thread(go)

    @r.get("/api/albums/rev")
    def albums_rev():
        return {"rev": albums.rev()}

    @r.get("/api/albums/candidates")
    async def album_candidates():
        return await asyncio.to_thread(candidates)

    @r.post("/api/albums")
    def create_album(req: AlbumCreate):
        return judged(albums.create(req.title, req.release_date))

    @r.put("/api/albums/{album_id}")
    def update_album(album_id: str, req: AlbumUpdate):
        return run(albums.update, album_id, title=req.title, release_date=req.release_date, crossfade=req.crossfade)

    @r.delete("/api/albums/{album_id}")
    def delete_album(album_id: str):
        try:
            albums.delete(album_id)
        except NotFound:
            raise HTTPException(status_code=404, detail="That album isn't there any more") from None
        return {"ok": True}

    @r.post("/api/albums/{album_id}/songs")
    def add_album_songs(album_id: str, req: AlbumAdd):
        return run(albums.add_songs, album_id, [s.model_dump() for s in req.songs])

    @r.put("/api/albums/{album_id}/order")
    def order_album(album_id: str, req: AlbumOrder):
        return run(albums.reorder, album_id, req.paths)

    @r.put("/api/albums/{album_id}/song")
    def change_album_song(album_id: str, req: AlbumSongChange):
        ready = None if req.clear_ready else ("keep" if req.ready is None else req.ready)
        return run(albums.set_song, album_id, req.path, title=req.title,
                   gapless_after=req.gapless_after, ready=ready)

    @r.delete("/api/albums/{album_id}/song")
    def remove_album_song(album_id: str, path: str):
        return run(albums.remove_song, album_id, path)

    return r
