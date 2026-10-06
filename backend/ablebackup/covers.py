"""Custom cover art: the pictures someone adds, and which cover each song uses.

Kept identical in Backups and Uploader (only the package import differs). The state
lives in the catalog setting "covers"; the picture files live in a ``covers`` folder
next to the catalog database. The renderer shrinks pictures before sending them (and
sends their size), so nothing here decodes images; it only checks the bytes really are
the type they claim to be.

State::

    {"rule": "genre"|"mix"|"one", "style": "ink"|"photo"|"strip",
     "pictures": [{"id", "name", "use", "genres", "main", "w", "h", "file"}],
     "projects": {"<project or mix name>": {"pic", "use", "fx", "fy", "style"}}}
"""
import base64
import binascii
import hmac
import threading
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ablebackup.api.auth import require_token

SETTING = "covers"
MAX_BYTES = 12 * 1024 * 1024
MAX_NAME = 80
MAX_GENRES = 40
MAX_GENRE_LEN = 40
TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MEDIA = {ext: mime for mime, ext in TYPES.items()}
CACHE = "max-age=31536000, immutable"  # ids are never reused

Use = Literal["background", "full"]
Style = Literal["ink", "photo", "strip"]

_lock = threading.Lock()


# ---- state -------------------------------------------------------------------
def default_state() -> dict:
    return {"rule": "genre", "style": "ink", "pictures": [], "projects": {}}


def load(catalog) -> dict:
    return from_saved(catalog.get_setting(SETTING))


def from_saved(saved) -> dict:
    """A stored "covers" setting, with defaults filled in and junk dropped."""
    state = default_state()
    if isinstance(saved, dict):
        if saved.get("rule") in ("genre", "mix", "one"):
            state["rule"] = saved["rule"]
        if saved.get("style") in ("ink", "photo", "strip"):
            state["style"] = saved["style"]
        if isinstance(saved.get("pictures"), list):
            state["pictures"] = [p for p in saved["pictures"] if isinstance(p, dict) and p.get("id")]
        if isinstance(saved.get("projects"), dict):
            state["projects"] = saved["projects"]
    return state


def public(state: dict, url_prefix: str = "/api/covers/img/") -> dict:
    """The state as the renderer sees it: each picture gets a url, never its file."""
    pictures = []
    for p in state.get("pictures", []):
        q = {k: v for k, v in p.items() if k != "file"}
        q["url"] = url_prefix + str(p.get("id"))
        pictures.append(q)
    return {**state, "pictures": pictures}


def folder_for(db_path) -> Path:
    return Path(db_path).parent / "covers"


def clean_name(name: Optional[str]) -> str:
    return (name or "").strip()[:MAX_NAME]


def clean_genres(genres) -> list[str]:
    out: list[str] = []
    for g in genres or []:
        g = str(g).strip()[:MAX_GENRE_LEN]
        if g and g not in out:
            out.append(g)
        if len(out) >= MAX_GENRES:
            break
    return out


def clamp(v, default: float = 0.5) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    if v != v:  # NaN
        return default
    return min(1.0, max(0.0, v))


def decode_data_url(data: str, allowed=TYPES) -> tuple[str, bytes]:
    """Return (mime, bytes) from a ``data:image/...;base64,`` URL, or raise 400/413."""
    if not isinstance(data, str) or not data.startswith("data:") or "," not in data:
        raise HTTPException(status_code=400, detail="not a data URL")
    head, b64 = data[5:].split(",", 1)
    parts = head.split(";")
    mime = parts[0].strip().lower()
    if mime not in allowed:
        raise HTTPException(status_code=400, detail="pictures must be JPEG, PNG or WebP")
    if "base64" not in [x.strip().lower() for x in parts[1:]]:
        raise HTTPException(status_code=400, detail="picture data must be base64")
    b64 = "".join(b64.split())
    if len(b64) * 3 // 4 > MAX_BYTES + 3:
        raise HTTPException(status_code=413, detail="picture is too big (12 MB at most)")
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="picture data is not valid base64")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="picture is too big (12 MB at most)")
    if not magic_ok(mime, raw):
        raise HTTPException(status_code=400, detail="picture data does not match its type")
    return mime, raw


def magic_ok(mime: str, raw: bytes) -> bool:
    if mime == "image/jpeg":
        return raw[:3] == b"\xff\xd8\xff"
    if mime == "image/png":
        return raw[:4] == b"\x89PNG"
    if mime == "image/webp":
        return len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    return False


def _find(state: dict, pic_id: str) -> Optional[dict]:
    for p in state["pictures"]:
        if p.get("id") == pic_id:
            return p
    return None


def picture_path(folder: Path, state: dict, pic_id: str) -> Optional[Path]:
    """The file of a picture in ``state``, built only from its stored file name."""
    p = _find(state, pic_id)
    if not p or not p.get("file"):
        return None
    name = Path(str(p["file"])).name  # stored by us, but never step out of the folder
    path = Path(folder) / name
    return path if path.is_file() else None


def image_response(path: Path) -> FileResponse:
    media = MEDIA.get(path.suffix.lower().lstrip("."), "application/octet-stream")
    return FileResponse(path, media_type=media, headers={"Cache-Control": CACHE})


def query_token_ok(app, t: str) -> bool:
    """An <img> can't send the auth header, so the token rides in the query."""
    expected = app.state.token
    return (not expected) or hmac.compare_digest(t or "", expected)


# ---- requests ----------------------------------------------------------------
class SettingsRequest(BaseModel):
    rule: Optional[Literal["genre", "mix", "one"]] = None
    style: Optional[Style] = None


class AddPictureRequest(BaseModel):
    data: str
    name: Optional[str] = None
    use: Use = "background"
    w: int = Field(ge=0)
    h: int = Field(ge=0)


class PatchPictureRequest(BaseModel):
    name: Optional[str] = None
    use: Optional[Use] = None
    genres: Optional[list[str]] = None
    main: Optional[bool] = None


class Choice(BaseModel):
    pic: Optional[str] = None
    use: Optional[Use] = None
    fx: Optional[float] = None
    fy: Optional[float] = None
    style: Optional[Style] = None  # None = the global style


class ChoiceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    choice: Optional[Choice] = None


# ---- routes ------------------------------------------------------------------
def install(app: FastAPI, catalog, db_path, extra=None) -> None:
    """Add the /api/covers routes to ``app``. ``extra``, when given, returns more keys
    for GET /api/covers (Uploader adds the covers chosen in Backups)."""
    folder = folder_for(db_path)
    auth = [Depends(require_token)]

    def save(state: dict) -> dict:
        catalog.set_setting(SETTING, state)
        return public(state)

    @app.get("/api/covers", dependencies=auth)
    def covers_get():
        out = public(load(catalog))
        if extra is not None:
            out.update(extra())
        return out

    @app.put("/api/covers/settings", dependencies=auth)
    def covers_settings(req: SettingsRequest):
        with _lock:
            state = load(catalog)
            if req.rule is not None:
                state["rule"] = req.rule
            if req.style is not None:
                state["style"] = req.style
            return save(state)

    @app.post("/api/covers/pictures", dependencies=auth)
    def covers_add(req: AddPictureRequest):
        mime, raw = decode_data_url(req.data)
        pic_id = uuid.uuid4().hex[:12]
        file = f"{pic_id}.{TYPES[mime]}"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / file).write_bytes(raw)
        with _lock:
            state = load(catalog)
            name = clean_name(req.name) or f"Picture {len(state['pictures']) + 1}"
            state["pictures"].append({
                "id": pic_id, "name": name, "use": req.use, "genres": [],
                "main": not state["pictures"], "w": req.w, "h": req.h, "file": file,
            })
            return save(state)

    @app.patch("/api/covers/pictures/{pic_id}", dependencies=auth)
    def covers_patch(pic_id: str, req: PatchPictureRequest):
        with _lock:
            state = load(catalog)
            p = _find(state, pic_id)
            if p is None:
                raise HTTPException(status_code=404, detail="no such picture")
            if req.name is not None:
                p["name"] = clean_name(req.name) or p.get("name") or "Picture"
            if req.use is not None:
                p["use"] = req.use
            if req.genres is not None:
                p["genres"] = clean_genres(req.genres)
            if req.main is not None:
                if req.main:
                    for other in state["pictures"]:
                        other["main"] = False
                p["main"] = bool(req.main)
            return save(state)

    @app.delete("/api/covers/pictures/{pic_id}", dependencies=auth)
    def covers_delete(pic_id: str):
        with _lock:
            state = load(catalog)
            p = _find(state, pic_id)
            if p is None:
                raise HTTPException(status_code=404, detail="no such picture")
            path = picture_path(folder, state, pic_id)
            state["pictures"] = [x for x in state["pictures"] if x.get("id") != pic_id]
            state["projects"] = {k: v for k, v in state["projects"].items()
                                 if not (isinstance(v, dict) and v.get("pic") == pic_id)}
            out = save(state)
        if path is not None:
            try:
                path.unlink()
            except OSError:
                pass
        return out

    @app.put("/api/covers/choice", dependencies=auth)
    def covers_choice(req: ChoiceRequest):
        with _lock:
            state = load(catalog)
            if req.choice is None:
                state["projects"].pop(req.name, None)
                return save(state)
            c = req.choice
            if c.pic is not None and _find(state, c.pic) is None:
                raise HTTPException(status_code=404, detail="no such picture")
            state["projects"][req.name] = {
                "pic": c.pic, "use": c.use,
                "fx": clamp(c.fx), "fy": clamp(c.fy), "style": c.style,
            }
            return save(state)

    @app.get("/api/covers/img/{pic_id}")
    def covers_img(pic_id: str, t: str = ""):
        if not query_token_ok(app, t):
            raise HTTPException(status_code=401, detail="invalid or missing token")
        path = picture_path(folder, load(catalog), pic_id)
        if path is None:
            raise HTTPException(status_code=404, detail="no such picture")
        return image_response(path)
