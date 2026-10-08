"""Your phone: a paired phone can browse your projects and albums and fetch songs over
your home Wi-Fi. Off until you switch it on in Settings.

Files on this computer are only read, never changed, moved or converted. A phone keeps
its own copy of a song only when its owner chooses to keep it there.

How it fits together:
- The desktop app asks for a pairing code (`new_code`) and shows it as a picture to
  scan. The code works once, for ten minutes.
- The phone sends that code to `/phone/pair` and gets its own key back. Only a
  fingerprint of each key is stored here, so the settings never hold a usable key.
- While switched on, a second small server answers phones on the home network. It
  has its own short list of routes (see `make_phone_app`) and serves only songs
  Backups already knows: a project's exports or a song on an album.
"""
import hashlib
import hmac
import os
import secrets
import socket
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from ablebackup import playback

DEFAULT_PORT = 8754
CODE_LIFE = 600          # seconds a pairing code works
SEEN_EVERY = 60          # seconds between saving a phone's "last seen" time
SETTING = "phone"


def _fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def home_address() -> str:
    """This computer's address on the home network. Opening a UDP socket toward a
    public address picks the right network card without sending anything."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))   # a documentation address; nothing is sent
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class PhoneLink:
    """Pairing, the list of paired phones, and the phone server's on/off switch."""

    def __init__(self, catalog, port: int = DEFAULT_PORT, serve: bool = True):
        self.catalog = catalog
        self.port = port
        self.serve = serve          # tests switch the real network server off
        self._code: tuple[str, float] | None = None
        self._lock = threading.Lock()
        self._server = None
        self._thread: threading.Thread | None = None
        self.app: FastAPI | None = None   # set by make_phone_app

    # ── stored state ──────────────────────────────────────────────────────────
    def _state(self) -> dict:
        s = self.catalog.get_setting(SETTING) or {}
        return {"enabled": bool(s.get("enabled")), "devices": list(s.get("devices") or [])}

    def _save(self, s: dict) -> None:
        self.catalog.set_setting(SETTING, s)

    def status(self) -> dict:
        s = self._state()
        return {
            "enabled": s["enabled"],
            "running": self.running,
            "address": home_address(),
            "port": self.port,
            "computer": socket.gethostname(),
            "devices": [{k: d.get(k) for k in ("id", "name", "paired_at", "last_seen")}
                        for d in s["devices"]],
        }

    # ── pairing ───────────────────────────────────────────────────────────────
    def new_code(self) -> dict:
        """A one-time code for the desktop app to show as a picture to scan."""
        if not self._state()["enabled"]:
            raise PermissionError("Switch on \"Let my phone connect\" first.")
        code = secrets.token_urlsafe(16)
        with self._lock:
            self._code = (code, time.time() + CODE_LIFE)
        host = home_address()
        return {"code": code, "host": host, "port": self.port, "expires_in": CODE_LIFE,
                "link": f"lazycreatives://pair?host={host}&port={self.port}&code={code}"}

    def pair(self, code: str, name: str) -> dict:
        with self._lock:
            current = self._code
            ok = (current is not None and time.time() < current[1]
                  and hmac.compare_digest(code or "", current[0]))
            if ok:
                self._code = None     # a code works once
        if not ok:
            raise PermissionError("That code has run out. Show a new one in Backups' Settings.")
        key = secrets.token_urlsafe(32)
        now = time.time()
        device = {"id": uuid.uuid4().hex[:12], "name": (name or "Phone").strip()[:60] or "Phone",
                  "key": _fingerprint(key), "paired_at": now, "last_seen": now}
        with self._lock:
            s = self._state()
            s["devices"].append(device)
            self._save(s)
        return {"key": key, "device_id": device["id"], "computer": socket.gethostname()}

    def device_for(self, key: str) -> dict | None:
        if not key:
            return None
        fp = _fingerprint(key)
        with self._lock:
            s = self._state()
            if not s["enabled"]:
                return None
            for d in s["devices"]:
                if hmac.compare_digest(d.get("key", ""), fp):
                    if time.time() - (d.get("last_seen") or 0) > SEEN_EVERY:
                        d["last_seen"] = time.time()
                        self._save(s)
                    return d
        return None

    def remove(self, device_id: str) -> bool:
        with self._lock:
            s = self._state()
            keep = [d for d in s["devices"] if d.get("id") != device_id]
            if len(keep) == len(s["devices"]):
                return False
            s["devices"] = keep
            self._save(s)
            return True

    # ── the phone server ─────────────────────────────────────────────────────
    def set_enabled(self, on: bool) -> dict:
        with self._lock:
            s = self._state()
            s["enabled"] = bool(on)
            self._save(s)
            if not on:
                self._code = None
        if on:
            self.start()
        else:
            self.stop()
        return self.status()

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if not self.serve or self.running or self.app is None:
            return
        import uvicorn
        config = uvicorn.Config(self.app, host="0.0.0.0", port=self.port,
                                log_level="warning", timeout_graceful_shutdown=2)
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, name="phone-server", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._server = None
        self._thread = None


class PairRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200)
    name: str = Field("", max_length=60)


def make_phone_app(link: PhoneLink, catalog, albums, known_song: Callable[[str], bool]) -> FastAPI:
    """The small server phones talk to. Every route but pairing needs a paired
    phone's key, sent as `Authorization: Bearer <key>` (or `?k=` for the player)."""
    app = FastAPI(title="ablebackup-phone", docs_url=None, redoc_url=None, openapi_url=None)
    # Phones send their key in a header, not a cookie, so any origin is safe here
    # (the phone app's preview runs in a browser at its own address).
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"],
                       allow_headers=["*"])

    def phone(request: Request, authorization: str = Header(default="")) -> dict:
        key = authorization[7:] if authorization.lower().startswith("bearer ") else ""
        key = key or request.query_params.get("k", "")
        d = link.device_for(key)
        if d is None:
            raise HTTPException(status_code=401, detail="This phone isn't paired.")
        return d

    def song_row(path: str, title: str = "", **extra) -> dict:
        p = Path(path)
        try:
            st = p.stat()
            size, mtime, exists = st.st_size, st.st_mtime, True
        except OSError:
            size, mtime, exists = 0, 0, False
        return {"path": path, "title": title or p.stem, "format": p.suffix.lstrip(".").upper(),
                "size": size, "mtime": mtime, "exists": exists, **extra}

    @app.post("/phone/pair")
    def pair(req: PairRequest):
        try:
            return link.pair(req.code, req.name)
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e)) from None

    @app.get("/phone/hello")
    def hello(d: dict = Depends(phone)):
        return {"computer": socket.gethostname(), "phone": d["name"]}

    @app.get("/phone/projects")
    def projects(_: dict = Depends(phone)):
        latest = catalog.latest_exports()
        out = []
        for r in catalog.library():
            ex = latest.get(r["project_id"])
            out.append({"id": r["project_id"], "name": r["name"], "daw": r.get("daw") or "",
                        "saved": r.get("mtime") or 0, "backed_up": bool(r.get("backed_up")),
                        "changed": bool(r.get("changed")), "songs": ex["count"] if ex else 0})
        out.sort(key=lambda p: -(p["saved"] or 0))
        return {"projects": out}

    @app.get("/phone/projects/{project_id}")
    def project(project_id: str, _: dict = Depends(phone)):
        p = next((r for r in catalog.library() if r["project_id"] == project_id), None)
        if p is None:
            raise HTTPException(status_code=404, detail="No such project.")
        songs = [song_row(e["path"], e.get("name") or "")
                 for e in catalog.exports_for(project_id) if e.get("kind") != "stem"]
        return {"id": project_id, "name": p["name"], "daw": p.get("daw") or "",
                "saved": p.get("mtime") or 0, "backed_up": bool(p.get("backed_up")),
                "changed": bool(p.get("changed")), "songs": songs}

    @app.get("/phone/albums")
    def album_list(_: dict = Depends(phone)):
        return {"rev": albums.rev(), "albums": [
            {"id": a["id"], "title": a["title"], "release_date": a["release_date"],
             "crossfade": a["crossfade"],
             "songs": [song_row(s["path"], s.get("title") or "", project=s.get("project") or "",
                                gapless_after=bool(s.get("gapless_after")))
                       for s in a["songs"]]}
            for a in albums.all()]}

    @app.get("/phone/song")
    def song(request: Request, path: str, _: dict = Depends(phone)):
        """A song, read from disk as it is. Formats a phone can't play (AIFF, Apple
        Lossless...) are decoded in memory on the way, never saved here."""
        if not known_song(path):
            raise HTTPException(status_code=404, detail="Not a song Backups knows.")
        try:
            return playback.response(path, request.headers.get("range"))
        except playback.CannotPlay:
            raise HTTPException(status_code=415, detail="This file can't be played.") from None

    link.app = app
    return app


def from_env(catalog) -> PhoneLink:
    return PhoneLink(catalog, port=int(os.environ.get("ABLEBACKUP_PHONE_PORT", DEFAULT_PORT)),
                     serve=os.environ.get("ABLEBACKUP_PHONE_SERVE", "1") != "0")
