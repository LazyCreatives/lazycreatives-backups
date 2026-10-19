"""The /api/folders routes, the same in both apps.

SHARED FILE: the same file lives in Backups (backend/ablebackup/folders_api.py) and
Uploader (backend/lazyupload/folders_api.py). Keep the two byte-identical.

Folders only hold project ids: nothing on the computer is moved or changed.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .folders import MAX_NAME, Folders, NotFound

_IDS = 5000


class FolderCreate(BaseModel):
    name: str = Field("", max_length=MAX_NAME * 2)
    project_ids: list[str] = Field(default_factory=list, max_length=_IDS)


class FolderRename(BaseModel):
    name: str = Field(..., max_length=MAX_NAME * 2)


class FolderProjects(BaseModel):
    project_ids: list[str] = Field(..., min_length=1, max_length=_IDS)


class FolderOrder(BaseModel):
    folder_ids: list[str] = Field(..., max_length=1000)


def make_router(auth, store: Folders | None = None) -> APIRouter:
    folders = store or Folders()
    r = APIRouter(dependencies=[Depends(auth)])

    def run(fn, *args):
        try:
            return fn(*args)
        except NotFound:
            raise HTTPException(status_code=404, detail="That folder isn't there any more") from None

    @r.get("/api/folders")
    def list_folders():
        return {"rev": folders.rev(), "folders": folders.all()}

    @r.get("/api/folders/rev")
    def folders_rev():
        return {"rev": folders.rev()}

    @r.post("/api/folders")
    def create_folder(req: FolderCreate):
        return folders.create(req.name, req.project_ids)

    @r.put("/api/folders/order")
    def order_folders(req: FolderOrder):
        return {"folders": folders.reorder(req.folder_ids)}

    @r.put("/api/folders/{folder_id}")
    def rename_folder(folder_id: str, req: FolderRename):
        return run(folders.rename, folder_id, req.name)

    @r.delete("/api/folders/{folder_id}")
    def delete_folder(folder_id: str):
        run(folders.delete, folder_id)
        return {"ok": True}

    @r.post("/api/folders/{folder_id}/projects")
    def add_to_folder(folder_id: str, req: FolderProjects):
        return run(folders.add, folder_id, req.project_ids)

    @r.post("/api/folders/{folder_id}/remove")
    def remove_from_folder(folder_id: str, req: FolderProjects):
        return run(folders.remove, folder_id, req.project_ids)

    return r
