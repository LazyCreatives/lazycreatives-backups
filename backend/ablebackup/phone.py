"""Your phone: a paired phone can browse your projects and albums and fetch songs over
your home Wi-Fi. Off until you switch it on in Settings.

Files on this computer are only read, never changed, moved or converted. A phone keeps
its own copy of a song only when its owner chooses to keep it there.

How it fits together:
- The desktop app asks for a pairing code (`new_code`) and shows it as a picture to
  scan. The code works once, for ten minutes. The picture also holds a secret that
  never travels over the Wi-Fi: only a phone that saw the screen knows it.
- The phone sends the code to `/phone/pair` with its name locked with that secret,
  and gets its own key back, locked the same way.
- While switched on, a second small server answers phones on the home network. It
  has its own short list of routes (see `make_phone_app`) and serves only songs
  Backups already knows: a project's exports or a song on an album.

Locking (so someone else on the same Wi-Fi can't read or fake anything):
- The phone's key itself is never sent. Each request is signed with it (`signed`),
  carries the time and a one-off nonce, and can't be replayed.
- Every answer is locked with AES-256-GCM (`seal`), tied to the request's nonce, so
  lists and songs can't be read on the way or swapped for older ones.
- The player streams a song it isn't keeping with a ticket (`ticket_ok`): a signed
  address that only fetches that one song, for a few hours. Those few bytes travel
  like any music stream; songs kept on the phone always travel locked.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import socket
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ablebackup import playback
from ablebackup.stempacks import part_name

DEFAULT_PORT = 8754
CODE_LIFE = 600          # seconds a pairing code works
SEEN_EVERY = 60          # seconds between saving a phone's "last seen" time
SETTING = "phone"
CLOCK = 600              # seconds a signed request's time may be off by
TICKET_LIFE = 6 * 3600   # longest a player ticket may last
CHUNK = 1 << 20          # a locked song travels in pieces of this size


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64url(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def keys_for(secret: bytes) -> tuple[bytes, bytes]:
    """The locking key and the signing key, both made from one phone's key."""
    return (hashlib.sha256(secret + b"lock").digest(), hashlib.sha256(secret + b"sign").digest())


def seal(key: bytes, data: bytes, aad: bytes) -> bytes:
    """AES-256-GCM: a fresh 12-byte nonce, then the locked bytes and their 16-byte tag."""
    iv = secrets.token_bytes(12)
    return iv + AESGCM(key).encrypt(iv, data, aad)


def unseal(key: bytes, blob: bytes, aad: bytes) -> bytes:
    return AESGCM(key).decrypt(blob[:12], blob[12:], aad)


def sign(key: bytes, *parts: str) -> str:
    return hmac.new(key, "\n".join(parts).encode(), hashlib.sha256).hexdigest()


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
        self._code: tuple[str, float, bytes] | None = None
        self._seen: dict[tuple[str, str], float] = {}   # nonces already used, until when
        self._lock = threading.Lock()
        self._server = None
        self._thread: threading.Thread | None = None
        self.app: FastAPI | None = None   # set by make_phone_app

    # ── stored state ──────────────────────────────────────────────────────────
    def _state(self) -> dict:
        s = self.catalog.get_setting(SETTING) or {}
        # Phones paired before requests were signed have no secret here: they pair again.
        return {"enabled": bool(s.get("enabled")),
                "devices": [d for d in s.get("devices") or [] if d.get("secret")]}

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
        secret = secrets.token_bytes(32)
        with self._lock:
            self._code = (code, time.time() + CODE_LIFE, secret)
        host = home_address()
        return {"code": code, "host": host, "port": self.port, "expires_in": CODE_LIFE,
                "link": f"lazycreatives://pair?host={host}&port={self.port}&code={code}"
                        f"&s={b64url(secret)}"}

    def pair(self, code: str, locked: str) -> str:
        """The phone's name arrives locked with the picture's secret, which proves the
        phone saw the screen. Its new key goes back locked the same way."""
        refused = PermissionError("That code has run out. Show a new one in Backups' Settings.")
        with self._lock:
            current = self._code
            ok = (current is not None and time.time() < current[1]
                  and hmac.compare_digest(code or "", current[0]))
        if not ok:
            raise refused
        try:
            name = json.loads(unseal(current[2], unb64url(locked), f"pair:{code}".encode()))["name"]
        except Exception:
            raise refused from None
        with self._lock:
            if self._code is not current:   # used meanwhile: a code works once
                raise refused
            self._code = None
        key = secrets.token_bytes(32)
        now = time.time()
        device = {"id": uuid.uuid4().hex[:12], "name": (str(name or "") or "Phone").strip()[:60] or "Phone",
                  "secret": key.hex(), "paired_at": now, "last_seen": now}
        with self._lock:
            s = self._state()
            s["devices"].append(device)
            self._save(s)
        answer = {"key": b64url(key), "device_id": device["id"], "computer": socket.gethostname()}
        return b64url(seal(current[2], json.dumps(answer).encode(), f"paired:{code}".encode()))

    def _device(self, device_id: str) -> dict | None:
        """A paired phone, while the switch is on."""
        with self._lock:
            s = self._state()
            if not s["enabled"]:
                return None
            for d in s["devices"]:
                if hmac.compare_digest(d.get("id", ""), device_id or ""):
                    if time.time() - (d.get("last_seen") or 0) > SEEN_EVERY:
                        d["last_seen"] = time.time()
                        self._save(s)
                    return d
        return None

    def signed(self, device_id: str, when: str, nonce: str, signature: str,
               method: str, target: str) -> dict | None:
        """The phone a signed request came from, or None. A request is good once,
        within CLOCK seconds of now."""
        try:
            t = int(when)
        except (TypeError, ValueError):
            return None
        if abs(time.time() - t) > CLOCK or not (16 <= len(nonce or "") <= 64):
            return None
        d = self._device(device_id)
        if d is None:
            return None
        good = sign(keys_for(bytes.fromhex(d["secret"]))[1], method, target, when, nonce)
        if not hmac.compare_digest(good, signature or ""):
            return None
        with self._lock:
            now = time.time()
            for k in [k for k, v in self._seen.items() if v < now]:
                del self._seen[k]
            if (device_id, nonce) in self._seen:
                return None
            self._seen[(device_id, nonce)] = now + 2 * CLOCK
        return d

    def ticket_ok(self, device_id: str, path: str, until: str, signature: str) -> bool:
        try:
            t = int(until)
        except (TypeError, ValueError):
            return False
        if not time.time() < t <= time.time() + TICKET_LIFE + CLOCK:
            return False
        d = self._device(device_id)
        if d is None:
            return False
        good = sign(keys_for(bytes.fromhex(d["secret"]))[1], "song", path, until)
        return hmac.compare_digest(good, signature or "")

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
    locked: str = Field(..., min_length=1, max_length=2000)   # its name, locked with the picture's secret


def make_phone_app(link: PhoneLink, catalog, albums, known_song: Callable[[str], bool],
                   folders=None) -> FastAPI:
    """The small server phones talk to. Every route but pairing needs a request signed
    with a paired phone's key (see the module's notes), and every answer is locked."""
    app = FastAPI(title="ablebackup-phone", docs_url=None, redoc_url=None, openapi_url=None)
    # Requests are signed in headers, not cookies, so any origin is safe here
    # (the phone app's preview runs in a browser at its own address).
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"],
                       allow_headers=["*"])

    def phone(request: Request) -> dict:
        h = request.headers
        target = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        d = link.signed(h.get("x-lc-phone", ""), h.get("x-lc-time", ""), h.get("x-lc-nonce", ""),
                        h.get("x-lc-sign", ""), request.method, target)
        if d is None:
            raise HTTPException(status_code=401, detail="This phone isn't paired.")
        request.state.nonce = h.get("x-lc-nonce", "")
        return d

    def locked(request: Request, d: dict, body) -> Response:
        key = keys_for(bytes.fromhex(d["secret"]))[0]
        data = seal(key, json.dumps(body).encode(), f"answer:{request.state.nonce}".encode())
        return Response(content=data, media_type="application/octet-stream")

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
            return {"locked": link.pair(req.code, req.locked)}
        except PermissionError as e:
            raise HTTPException(status_code=403, detail=str(e)) from None

    @app.get("/phone/hello")
    def hello(request: Request, d: dict = Depends(phone)):
        return locked(request, d, {"computer": socket.gethostname(), "phone": d["name"]})

    @app.get("/phone/projects")
    def projects(request: Request, d: dict = Depends(phone)):
        latest = catalog.latest_exports()
        out = []
        for r in catalog.library():
            ex = latest.get(r["project_id"])
            count = ex["count"] if ex else 0
            if r.get("daw") == "stems":  # a stems-only folder: its stems are what there is to hear
                count = len(catalog.exports_for(r["project_id"]))
            out.append({"id": r["project_id"], "name": r["name"], "daw": r.get("daw") or "",
                        "saved": r.get("mtime") or 0, "backed_up": bool(r.get("backed_up")),
                        "changed": bool(r.get("changed")), "songs": count})
        out.sort(key=lambda p: -(p["saved"] or 0))
        # your folders (the app's own, see folders.py), only naming projects there are
        have = {p["id"] for p in out}
        shelf = [{"id": f["id"], "name": f["name"], "project_ids": [i for i in f["project_ids"] if i in have]}
                 for f in (folders.all() if folders else [])]
        return locked(request, d, {"projects": out, "folders": shelf})

    @app.get("/phone/projects/{project_id}")
    def project(request: Request, project_id: str, d: dict = Depends(phone)):
        p = next((r for r in catalog.library() if r["project_id"] == project_id), None)
        if p is None:
            raise HTTPException(status_code=404, detail="No such project.")
        stems_only = p.get("daw") == "stems"  # a stems-only folder lists its stems, mix first
        rows = sorted(catalog.exports_for(project_id), key=lambda e: (e.get("kind") == "stem",
                                                                     (e.get("name") or "").lower())) \
            if stems_only else catalog.exports_for(project_id)
        # a stem shows the part it holds ("Kick", not "Night Drive - Kick")
        songs = [song_row(e["path"], part_name(e.get("name") or "", p["name"]) if e.get("kind") == "stem"
                          else e.get("name") or "")
                 for e in rows if stems_only or e.get("kind") != "stem"]
        return locked(request, d, {"id": project_id, "name": p["name"], "daw": p.get("daw") or "",
                                   "saved": p.get("mtime") or 0, "backed_up": bool(p.get("backed_up")),
                                   "changed": bool(p.get("changed")), "songs": songs})

    @app.get("/phone/albums")
    def album_list(request: Request, d: dict = Depends(phone)):
        return locked(request, d, {"rev": albums.rev(), "albums": [
            {"id": a["id"], "title": a["title"], "release_date": a["release_date"],
             "crossfade": a["crossfade"],
             "songs": [song_row(s["path"], s.get("title") or "", project=s.get("project") or "",
                                gapless_after=bool(s.get("gapless_after")))
                       for s in a["songs"]]}
            for a in albums.all()]})

    def song_bytes(path: str):
        """A song as the phone gets it: the file read from disk as it is, or decoded in
        memory for formats a phone can't play (AIFF, Apple Lossless...), never saved here."""
        if not known_song(path):
            raise HTTPException(status_code=404, detail="Not a song Backups knows.")
        if not playback.native(path):
            try:
                data = playback.decode(path)
                return (data[i:i + CHUNK] for i in range(0, len(data), CHUNK))
            except playback.CannotPlay:
                pass    # handed over as it is, for the phone's player to try (as playback.response)

        def read():
            with open(path, "rb") as f:
                while chunk := f.read(CHUNK):
                    yield chunk
        return read()

    @app.get("/phone/song")
    def song(request: Request, path: str, d: dict = Depends(phone)):
        """A song to keep on the phone, locked piece by piece: each piece is its length
        (4 bytes) and then the locked bytes, tied to the request, its place in the song
        and whether it's the last, so nothing can be cut off, swapped or reordered."""
        key = keys_for(bytes.fromhex(d["secret"]))[0]
        nonce = request.state.nonce
        pieces = song_bytes(path)

        def locked_pieces():
            i, prev = 0, next(pieces, b"")
            while True:
                nxt = next(pieces, None)
                last = nxt is None
                blob = seal(key, prev, f"song:{nonce}:{i}:{'end' if last else 'more'}".encode())
                yield len(blob).to_bytes(4, "big") + blob
                if last:
                    return
                i, prev = i + 1, nxt

        return StreamingResponse(locked_pieces(), media_type="application/octet-stream")

    @app.get("/phone/play")
    def play(request: Request, path: str, d: str = "", until: str = "", sig: str = ""):
        """The player's stream of a song it isn't keeping, with a ticket for that song."""
        if not link.ticket_ok(d, path, until, sig):
            raise HTTPException(status_code=401, detail="This phone isn't paired.")
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
