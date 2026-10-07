"""FastAPI application factory for the backup sidecar."""
import asyncio
import hmac
import json
import os
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from ablebackup import covers, entitlement, exports, markers, playback, plugins, tidy, waveform
from ablebackup.albums import LOSSLESS, Albums
from ablebackup.albums_api import make_router as albums_router
from ablebackup.api.auth import require_token, ws_token_ok
from ablebackup.api.progress import ProgressHub
from ablebackup.api.schemas import (
    ActivateRequest, BackupRequest, CloudConnectRequest, CloudDisconnectRequest,
    Config, ExportFoldersRequest, ExportIgnoreRequest, ExportLinkRequest, GenreRequest,
    PluginFoldersRequest, RestoreRequest, ScanRequest, TidyRequest, TidyUndoRequest,
)
from ablebackup.catalog import Catalog
from ablebackup.scheduler import BackupScheduler
from ablebackup.service import (
    _build_locator,
    CLOUD_FOLDER_SUBDIR, CLOUD_PROVIDERS, CloudConnectSession, cloud_folders, build_overview, cloud_disconnect,
    default_timestamp, full_disk_access_ok, pool_cache_age, rclone_available,
    backfill_genres, project_genres, relearn_genres, rclone_remotes, refresh_pool_cache,
    resolve_scan_roots, restore_snapshot, run_backup, safe_remote_name, scan_summary,
    share_snapshot, snapshot_diff,
)
from ablebackup.resolver import _allowed_external_file
from ablebackup.scanner import scan_one
from ablebackup.songmatch import is_stem
from ablebackup.suggest import suggested_folders
from ablebackup.verifier import verify_snapshot


def create_app(token: str, db_path: Path) -> FastAPI:
    catalog = Catalog(Path(db_path))
    hub = ProgressHub()
    scheduler = BackupScheduler(catalog, hub)  # scheduled runs stream to the UI

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.bind_loop(asyncio.get_running_loop())
        saved = catalog.get_setting("config") or {}
        scheduler.set_interval(saved.get("interval_minutes", 0))
        # Re-link song exports to projects in the background on every start, so songs
        # saved since the last scan (or a library from before this feature) show up
        # without needing a new scan.
        # A daemon thread, so quitting the app never waits for it to finish.
        threading.Thread(target=exports.refresh, args=(catalog,), daemon=True,
                         name="exports-refresh").start()
        yield
        scheduler.shutdown()
        catalog.close()

    app = FastAPI(title="ablebackup", lifespan=lifespan)
    # The Electron renderer runs at a different origin (dev: http://localhost:5173,
    # packaged: file://) than the sidecar, so the browser sends CORS preflight
    # OPTIONS requests. Auth is via the X-Auth-Token header (not cookies), so it is
    # safe to allow all origins on this localhost-only server.
    app.add_middleware(
        # Localhost-only service: allow just the renderer's real origins — the dev
        # Vite server and the packaged file:// renderer (which sends Origin: null) —
        # instead of "*", so a random web page can't probe the API. Auth is still the
        # real boundary (every /api route requires the token).
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "null"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.token = token
    app.state.catalog = catalog
    app.state.hub = hub
    app.state.scheduler = scheduler
    app.state.jobs = {}
    app.state.cancels = {}  # job_id -> threading.Event, to cancel a running backup
    app.state.pool_refreshing = False  # guard so only one pool-size walk runs at a time
    app.state.pool_tasks = set()        # strong refs so tasks aren't GC'd mid-run
    app.state.cloud_sessions = {}       # connect_id -> CloudConnectSession (OAuth in flight)
    covers.install(app, catalog, db_path)  # custom cover art: /api/covers/...

    _JOBS_CAP = 200

    def _new_job(job_id: str) -> None:
        """Register a running job, evicting the oldest finished entries so the jobs
        dict can't grow without bound over a long-lived (tray) session."""
        jobs = app.state.jobs
        for jid in list(jobs):
            if len(jobs) < _JOBS_CAP:
                break
            if jobs[jid].get("state") in ("done", "error"):
                del jobs[jid]
        jobs[job_id] = {"state": "running"}

    def _refresh_pool_async(dest: str):
        """Recompute the cached pool size off the event loop, without overlapping."""
        # Set the guard SYNCHRONOUSLY (before the await turn) so two near-simultaneous
        # callers can't both pass the check and launch duplicate NAS walks.
        if not dest or app.state.pool_refreshing:
            return
        app.state.pool_refreshing = True

        async def _run():
            try:
                await asyncio.to_thread(refresh_pool_cache, app.state.catalog, dest)
            finally:
                app.state.pool_refreshing = False

        t = asyncio.create_task(_run())
        app.state.pool_tasks.add(t)
        t.add_done_callback(app.state.pool_tasks.discard)

    app.state.genre_backfilling = False

    def _backfill_genres_async():
        """Fill uncached project genres off the request path (reading .als tempos is
        slow). One at a time; cached results make subsequent loads instant."""
        if app.state.genre_backfilling:
            return
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return  # no event loop (e.g. bare TestClient) — skip background work
        app.state.genre_backfilling = True

        async def _run():
            try:
                await asyncio.to_thread(backfill_genres, app.state.catalog)
            finally:
                app.state.genre_backfilling = False

        t = asyncio.create_task(_run())
        app.state.pool_tasks.add(t)
        t.add_done_callback(app.state.pool_tasks.discard)

    @app.get("/health")
    def health():
        # `player`: the bundled decoder for AIFF, Apple Lossless... is there
        return {"status": "ok", "player": bool(playback.ffmpeg())}

    def _tier() -> str:
        # verify_stored rejects a hand-edited/forged entitlement row -> 'free'.
        return entitlement.verify_stored(app.state.catalog.get_setting("entitlement") or {})

    def _allows(feature: str) -> bool:
        return entitlement.allows(_tier(), feature)

    def _validate_target(target: str) -> str:
        """Reject a restore/share target that isn't an existing writable folder, so
        a malformed/non-UI request can't scatter files into arbitrary locations."""
        t = (target or "").strip()
        if not t or not os.path.isabs(t) or not os.path.isdir(t) or not os.access(t, os.W_OK):
            raise HTTPException(status_code=400, detail="Choose an existing, writable folder.")
        return t

    @app.get("/api/rclone", dependencies=[Depends(require_token)])
    def rclone_info():
        return {"available": rclone_available(), "remotes": rclone_remotes()}

    _CLOUD_SESSIONS_CAP = 20

    @app.get("/api/cloud/providers", dependencies=[Depends(require_token)])
    def cloud_providers():
        return {"providers": [{"key": k, "label": v["label"]} for k, v in CLOUD_PROVIDERS.items()]}

    @app.get("/api/cloud/folders", dependencies=[Depends(require_token)])
    def cloud_folders_found():
        """Dropbox / Google Drive / iCloud / OneDrive folders on this computer, so
        the first-run screen can offer them as places to keep backups."""
        return {"folders": cloud_folders(), "subdir": CLOUD_FOLDER_SUBDIR}

    @app.post("/api/cloud/connect", dependencies=[Depends(require_token)])
    def cloud_connect(req: CloudConnectRequest):
        """Begin a browser OAuth sign-in for a cloud provider (e.g. Google Drive).

        Returns an auth URL for the renderer to open in the user's browser; the flow
        then completes in the background and the UI polls /api/cloud/connect/{id}.
        """
        if not _allows("cloud_backup"):
            raise HTTPException(status_code=403, detail="Cloud backup is a Studio feature.")
        if req.provider not in CLOUD_PROVIDERS:
            raise HTTPException(status_code=400, detail="Unknown cloud provider.")
        if not rclone_available():
            raise HTTPException(status_code=503, detail="The cloud engine (rclone) isn't installed.")
        sessions = app.state.cloud_sessions
        # Only one OAuth flow at a time — they share rclone's loopback port. Cancel any
        # still-pending session, then bound the dict by evicting finished ones oldest-first.
        for s in sessions.values():
            if s.status == "pending":
                s.cancel()
        while len(sessions) >= _CLOUD_SESSIONS_CAP:
            sessions.pop(next(iter(sessions)))
        name = safe_remote_name(req.name or req.provider, rclone_remotes())
        sess = CloudConnectSession(req.provider, name)
        sess.start()
        url = sess.wait_for_url(15)
        if sess.status == "failed":
            raise HTTPException(status_code=502, detail=sess.error or "Couldn't start the cloud sign-in.")
        connect_id = uuid.uuid4().hex
        sessions[connect_id] = sess
        return {"connect_id": connect_id, "auth_url": url, "remote": name, "provider": req.provider}

    @app.get("/api/cloud/connect/{connect_id}", dependencies=[Depends(require_token)])
    def cloud_connect_status(connect_id: str):
        sess = app.state.cloud_sessions.get(connect_id)
        if not sess:
            raise HTTPException(status_code=404, detail="Unknown cloud connection.")
        return {"status": sess.status, "remote": sess.name,
                "auth_url": sess.auth_url, "error": sess.error}

    @app.post("/api/cloud/disconnect", dependencies=[Depends(require_token)])
    def cloud_disconnect_endpoint(req: CloudDisconnectRequest):
        if not rclone_available():
            raise HTTPException(status_code=503, detail="The cloud engine (rclone) isn't installed.")
        ok = cloud_disconnect(req.name)
        return {"ok": ok, "remotes": rclone_remotes()}

    @app.get("/api/entitlement", dependencies=[Depends(require_token)])
    def get_entitlement():
        tier = _tier()
        return {"tier": tier, "beta": entitlement.free_beta(), "features": entitlement.features_for(tier)}

    @app.post("/api/entitlement/activate", dependencies=[Depends(require_token)])
    def activate(req: ActivateRequest):
        res = entitlement.activate(req.key)
        if res is None or res.get("tier") is None:
            raise HTTPException(status_code=400, detail="That licence key wasn't recognised.")
        key, iid = req.key.strip(), res.get("instance_id")
        app.state.catalog.set_setting("entitlement", {
            "tier": res["tier"], "key": key, "instance_id": iid,
            "sig": entitlement.sign_tier(res["tier"], key, iid),
        })
        return {"tier": res["tier"], "features": entitlement.features_for(res["tier"])}

    @app.post("/api/entitlement/deactivate", dependencies=[Depends(require_token)])
    def deactivate():
        ent = app.state.catalog.get_setting("entitlement") or {}
        entitlement.deactivate(ent.get("key", ""), ent.get("instance_id"))  # release the seat
        app.state.catalog.set_setting("entitlement", {"tier": "free"})
        app.state.scheduler.set_interval(0)  # automatic backup is Pro-only
        return {"tier": "free", "features": entitlement.features_for("free")}

    def _make_dest(dest: str) -> None:
        """Create a new backups folder inside one that exists (e.g. "Lazy Creatives
        Backups" in Dropbox). Never creates a missing drive or its parents."""
        d = Path(dest) if dest and os.path.isabs(dest) else None
        if d and not d.exists() and d.parent.is_dir():
            try:
                d.mkdir()
            except OSError:
                pass  # shown as "can't reach this folder" on Home

    @app.get("/api/settings", dependencies=[Depends(require_token)])
    def get_settings() -> Config:
        saved = app.state.catalog.get_setting("config")
        return Config(**saved) if saved else Config()

    @app.put("/api/settings", dependencies=[Depends(require_token)])
    def put_settings(config: Config) -> Config:
        if config.interval_minutes > 0 and not _allows("scheduled"):
            config.interval_minutes = 0  # automatic backup is Pro-only
        _make_dest(config.dest)
        app.state.catalog.set_setting("config", config.model_dump())
        app.state.scheduler.set_interval(config.interval_minutes)
        return config

    @app.get("/api/setup/suggested-folders", dependencies=[Depends(require_token)])
    def setup_suggested_folders():
        """The usual project folders on this computer, with how many projects each
        holds, for the first-run screen to offer as ready-ticked rows."""
        return suggested_folders()

    def _resolve_sources(supplied):
        if supplied:
            return [Path(s) for s in supplied]
        saved = app.state.catalog.get_setting("config") or {}
        return [Path(s) for s in saved.get("sources", [])]

    @app.post("/api/scan", dependencies=[Depends(require_token)])
    def scan(req: ScanRequest):
        cfg = app.state.catalog.get_setting("config") or {}
        # A scope ("home"/"volumes"/"users"/"entire") scans the Mac; otherwise the
        # configured sources (or an explicit list) — the default, unchanged behaviour.
        if req.scope and req.scope != "sources":
            sources = resolve_scan_roots(req.scope, _resolve_sources(req.sources))
        else:
            sources = _resolve_sources(req.sources)
        hub = app.state.hub

        def progress(ev):
            try:
                hub.publish_threadsafe(ev)
            except RuntimeError:
                pass  # no event loop bound (e.g. bare TestClient) — skip live ticks

        find_missing = req.find_missing and _allows("auto_relink")
        stats: dict = {}
        projects = scan_summary(
            sources, progress=progress, find_missing=find_missing,
            libraries=cfg.get("libraries", []), stats=stats,
            learned=app.state.catalog.genre_examples(),
            pointed=app.state.catalog.all_pointed())
        if not _allows("multi_daw"):
            projects = [p for p in projects if p.get("daw") == "ableton"]
        # Persist what we found so History shows the whole library, not just backups.
        app.state.catalog.upsert_discovered([
            {"project_id": p["project_id"], "name": p["name"], "path": p["als_path"],
             "dir": p["project_dir"], "daw": p["daw"], "owner": p.get("owner", "system"),
             "size": p["total_size"], "mtime": p["mtime"], "missing_count": p["missing_count"],
             "genre": p.get("genre"), "genre_emoji": p.get("genre_emoji"), "bpm": p.get("bpm"),
             "tracks": p.get("tracks"),
             "plugins": json.dumps(p.get("plugins") or []) if p.get("plugins") else None}
            for p in projects
        ], default_timestamp())
        exports.refresh(app.state.catalog)  # link song renders to the projects just found
        set_by_you = {r["project_id"]: r["genre"] for r in app.state.catalog.genres_set_by_you()}
        for p in projects:  # show the producer's genre, not the fresh guess
            if p["project_id"] in set_by_you:
                p["genre"] = set_by_you[p["project_id"]]
        return {"projects": projects, "scope": req.scope or "sources",
                "full_disk_access": full_disk_access_ok(),
                "skipped_dirs": stats.get("skipped_dirs", 0),
                "skipped_examples": stats.get("skipped_examples", [])}

    @app.get("/api/library", dependencies=[Depends(require_token)])
    def library():
        """Every project a scan has found, with backed-up status — grouped client-side
        by owner. This is the persistent History list."""
        rows = app.state.catalog.library()
        latest = app.state.catalog.latest_exports()
        uploaded = {e.get("path") for e in _uploaded_paths()}
        for r in rows:
            ex = latest.get(r["project_id"])
            r["export_count"] = ex["count"] if ex else 0
            r["latest_export"] = (
                {"path": ex["latest"]["path"], "name": ex["latest"]["name"],
                 "mtime": ex["latest"]["mtime"],
                 "uploaded": ex["latest"]["path"] in uploaded} if ex else None)
        owners = sorted({r["owner"] or "system" for r in rows})
        return {"projects": rows, "owners": owners, "count": len(rows),
                "unmatched_songs": len(app.state.catalog.unmatched())}

    @app.get("/api/genres", dependencies=[Depends(require_token)])
    def genre_list():
        """The genres the guesser knows, for the genre picker."""
        from ablebackup.genre import known_genres
        return {"genres": known_genres()}

    @app.post("/api/project/genre", dependencies=[Depends(require_token)])
    def set_genre(req: GenreRequest):
        """Correct the genre of one or more projects, or (genre=None) go back to the
        guess. Uploader reads the same record, so it follows the correction too."""
        genre = (req.genre or "").strip() or None
        n = app.state.catalog.set_project_genre(req.project_ids, genre)
        if not n:
            raise HTTPException(status_code=404, detail="Project not found.")
        # similar projects learn from the correction straight away
        return {"changed": n, "relearned": relearn_genres(app.state.catalog)}

    def _uploaded_paths() -> list[dict]:
        follow = tidy.follower(app.state.catalog)  # songs renamed since they were uploaded
        out = []
        for u in exports.uploader_uploads():
            if u.get("file_path"):
                out.append({"path": follow(exports._resolve(Path(u["file_path"])))})
        return out

    # ---- tidy names: rename a song's versions, folder and exports together ------
    def _tidy_opts(req: TidyRequest) -> dict:
        return {"names": req.names, "style": req.style, "numbers": req.numbers,
                "song_style": req.song_style,
                "folder": req.folder, "overrides": req.overrides, "skip": req.skip}

    def _backup_running() -> bool:
        return any(j.get("state") in ("running", "cancelling") for j in app.state.jobs.values())

    @app.post("/api/tidy/preview", dependencies=[Depends(require_token)])
    def tidy_preview(req: TidyRequest):
        """What Rename would do. Changes nothing."""
        return tidy.plan(app.state.catalog, req.project_ids, **_tidy_opts(req))

    @app.post("/api/tidy/apply", dependencies=[Depends(require_token)])
    def tidy_apply(req: TidyRequest):
        if _backup_running():
            raise HTTPException(status_code=409, detail="A backup is running. Rename once it has finished.")
        try:
            return tidy.apply(app.state.catalog, req.project_ids, **_tidy_opts(req))
        except tidy.TidyError as e:
            raise HTTPException(status_code=409, detail=str(e))

    @app.get("/api/tidy/last", dependencies=[Depends(require_token)])
    def tidy_last(project_id: str):
        return {"batch": tidy.last_batch(app.state.catalog, project_id)}

    @app.post("/api/tidy/undo", dependencies=[Depends(require_token)])
    def tidy_undo(req: TidyUndoRequest):
        if _backup_running():
            raise HTTPException(status_code=409, detail="A backup is running. Undo once it has finished.")
        try:
            return tidy.undo(app.state.catalog, req.batch_id)
        except tidy.TidyError as e:
            raise HTTPException(status_code=409, detail=str(e))

    # ---- song exports linked to projects (and their SoundCloud uploads) --------
    @app.get("/api/exports", dependencies=[Depends(require_token)])
    def project_exports(project_id: str):
        rows = app.state.catalog.exports_for(project_id)
        for r in rows:
            r["exists"] = os.path.isfile(r["path"])
        elsewhere = exports.attach_uploads(rows, project_id,
                                           follow=tidy.follower(app.state.catalog),
                                           follow_id=tidy.id_follower(app.state.catalog))
        return {"project_id": project_id, "exports": rows, "uploads_elsewhere": elsewhere,
                "uploader_installed": exports.find_uploader_db() is not None}

    @app.get("/api/exports/folders", dependencies=[Depends(require_token)])
    def exports_folders():
        """Where songs get exported: the user's own list, plus Uploader's watch
        folders (read-only, shown so people see why a song was found)."""
        cat = app.state.catalog
        return {"folders": [str(p) for p in exports.export_folders(cat)],
                "found_folders": [str(p) for p in exports.found_folders(cat)],
                "ignored": list(cat.get_setting("ignored_export_folders") or []),
                "uploader_folders": [str(p) for p in exports.uploader_sources()]}

    @app.put("/api/exports/folders", dependencies=[Depends(require_token)])
    def exports_set_folders(req: ExportFoldersRequest):
        folders = list(dict.fromkeys(f for f in req.folders if f.strip()))
        app.state.catalog.set_setting("export_folders", folders)
        if req.ignored is not None:
            app.state.catalog.set_setting(
                "ignored_export_folders", list(dict.fromkeys(f for f in req.ignored if f.strip())))
        # Re-check in the background; answer within a few seconds either way and let
        # the screen follow /api/exports/status if it's still going.
        return {"folders": folders, **exports.refresh_in_background(app.state.catalog, wait=8)}

    @app.post("/api/exports/refresh", dependencies=[Depends(require_token)])
    def exports_refresh():
        return exports.refresh_in_background(app.state.catalog, wait=8)

    @app.get("/api/exports/status", dependencies=[Depends(require_token)])
    def exports_status():
        """How the song re-check is going: running, folders_done / folders_total,
        the folder it's in, and how many songs were linked last time."""
        return exports.progress()

    # ---- plug-ins installed on this computer (the Plugins page) ----------------
    plugin_lock = threading.Lock()

    def _plugins(refresh: bool) -> dict:
        cat = app.state.catalog
        with plugin_lock:
            found = None if refresh else cat.get_setting("plugin_scan")
            if not found:
                found = plugins.scan(cat.get_setting("plugin_folders") or [])
                cat.set_setting("plugin_scan", found)
        rows = [dict(r) for r in found["plugins"]]
        projects = cat.library()
        plugins.used_in(rows, projects)
        return {**found, "plugins": rows, "projects_scanned": len(projects)}

    @app.get("/api/plugins", dependencies=[Depends(require_token)])
    def plugin_list(refresh: bool = False):
        """Every plug-in found in the usual plug-in folders (and the user's own), each
        with its formats, where it lives and how many projects use it. The last look
        is kept, so the page opens straight away; refresh=true looks again."""
        return _plugins(refresh)

    @app.put("/api/plugins/folders", dependencies=[Depends(require_token)])
    def plugin_set_folders(req: PluginFoldersRequest):
        folders = list(dict.fromkeys(f for f in req.folders if f.strip()))
        app.state.catalog.set_setting("plugin_folders", folders)
        return _plugins(True)

    @app.post("/api/exports/link", dependencies=[Depends(require_token)])
    def exports_link(req: ExportLinkRequest):
        p = Path(req.path)
        if p.suffix.lower() not in exports.AUDIO_EXTS or not p.is_file():
            raise HTTPException(status_code=400, detail="not an audio file")
        known = {d["project_id"] for d in app.state.catalog.discovered_projects()}
        if req.project_id not in known:
            raise HTTPException(status_code=404, detail="unknown project")
        st = p.stat()
        name = next((d["name"] for d in app.state.catalog.discovered_projects()
                     if d["project_id"] == req.project_id), "")
        kind = "stem" if is_stem(p, project=name) else "song"
        app.state.catalog.link_export(exports._resolve(p), req.project_id, p.stem,
                                      st.st_size, st.st_mtime, kind)
        return {"ok": True}

    @app.get("/api/exports/unmatched", dependencies=[Depends(require_token)])
    def exports_unmatched(ignored: bool = False):
        """Songs in your exports folders that no project matched, newest first, each
        with the project it's most likely from (suggest_id / suggest_why) if any."""
        rows = app.state.catalog.unmatched(ignored)
        for r in rows:
            r["exists"] = os.path.isfile(r["path"])
        return {"songs": rows, "count": len(rows)}

    @app.post("/api/exports/ignore", dependencies=[Depends(require_token)])
    def exports_ignore(req: ExportIgnoreRequest):
        """"Not a song": stop listing it as waiting for a project (or undo that)."""
        if not app.state.catalog.ignore_unmatched(req.path, req.ignored):
            raise HTTPException(status_code=404, detail="not in the list")
        return {"ok": True}

    @app.post("/api/exports/unlink", dependencies=[Depends(require_token)])
    def exports_unlink(req: ExportLinkRequest):
        if not app.state.catalog.hide_export(req.path, req.project_id):
            raise HTTPException(status_code=404, detail="not linked")
        return {"ok": True}

    def _known_song(path: str) -> bool:
        """A song Backups found itself: linked to a project, or waiting for one."""
        cat = app.state.catalog
        return ((cat.is_export(path) or cat.is_unmatched(path) or path in albums.paths())
                and os.path.isfile(path))

    # ---- albums: one list shared with Uploader (see albums.py) ----------------
    albums = Albums()

    def _album_candidates() -> list[dict]:
        """Songs that could go on an album: each project's exports, one file per song
        (a WAV and an MP3 of the same export count once, the WAV wins)."""
        best: dict[tuple, dict] = {}
        for r in app.state.catalog.album_candidates():
            p = Path(r["path"])
            key = (r["project_id"], str(p.with_suffix("")).lower())
            lossless = p.suffix.lower() in LOSSLESS
            cur = best.get(key)
            if cur is None or (lossless and not cur["lossless"]):
                best[key] = {"path": r["path"], "title": p.stem, "project": r["project"],
                             "project_id": r["project_id"], "daw": r["daw"] or "", "bpm": r["bpm"],
                             "genre": r["genre"] or "", "exported": r["mtime"], "lossless": lossless}
        return list(best.values())

    app.include_router(albums_router(require_token, lambda: Path(db_path), _album_candidates, albums))

    @app.get("/api/exports/audio")
    def exports_audio(request: Request, path: str, t: str = "", decode: int = 0):
        """Stream a linked export for the in-app player. An <audio> element can't send
        the auth header, so the token rides in the query; and only files already in the
        exports list are served, so this can't be used to read anything else. Formats
        the player can't read (AIFF, Apple Lossless, WMA...) are decoded in memory;
        `decode=1` asks for that even when the file looked playable."""
        expected = app.state.token
        if expected and not hmac.compare_digest(t or "", expected):
            raise HTTPException(status_code=401, detail="invalid or missing token")
        if not _known_song(path):
            raise HTTPException(status_code=404, detail="not a linked export")
        try:
            return playback.response(path, request.headers.get("range"), force=bool(decode))
        except playback.CannotPlay:
            raise HTTPException(status_code=415, detail="this file can't be played") from None

    @app.get("/api/exports/peaks", dependencies=[Depends(require_token)])
    def exports_peaks(path: str):
        """The outline of a linked export's sound, for drawing its waveform. `peaks` is
        null for formats read by the app itself (MP3 and the like)."""
        if not _known_song(path):
            raise HTTPException(status_code=404, detail="not a linked export")
        return {"peaks": waveform.peaks(path)}

    @app.get("/api/project/markers", dependencies=[Depends(require_token)])
    def project_markers(path: str):
        """The markers (locators, cues) saved in one project, in seconds, for showing on
        its song's waveform. Only projects in the library are read."""
        if path not in {r.get("path") for r in app.state.catalog.library()}:
            raise HTTPException(status_code=404, detail="not a project in the library")
        return {"markers": markers.read_markers(path)}

    @app.get("/api/project/missing", dependencies=[Depends(require_token)])
    def project_missing(path: str, find: bool = False):
        """The live, complete list of a single project's missing samples.

        Re-parses the project on demand so the list reflects the CURRENT state of disk
        (samples may have been moved or restored since the last scan) — an honest
        "what's missing right now, and exactly which files" the user can trust, rather
        than a stale count. Each entry is the sample's name and the path the project
        expects it at.

        When `find=1`, each missing sample is also classified `recoverable` — i.e. an
        exact match exists in the user's sample libraries + source folders, so "Fix
        now" will relink and back it up. Ones that aren't recoverable are the ones that
        genuinely need the user to point at the file. (The library walk makes find=1
        slower, so the UI loads the plain list first, then annotates.)
        """
        p = Path(path)
        if not p.exists():
            raise HTTPException(status_code=404, detail="project not found on disk")
        try:
            scan = scan_one(p)  # disk truth: every sample not at its expected path
        except ValueError:
            raise HTTPException(status_code=400, detail="not a recognized project file")
        recoverable: set[str] = set()
        if find and scan.missing:
            saved = app.state.catalog.get_setting("config") or {}
            sources = [str(s) for s in saved.get("sources", [])]
            locate = _build_locator(sources, saved.get("libraries", []))
            found = scan_one(p, locate=locate)  # same scan, but allowed to relink
            still_missing = {r.expected_path or r.name for r in found.missing}
            recoverable = {(r.expected_path or r.name) for r in scan.missing
                           if (r.expected_path or r.name) not in still_missing}
        # Files the producer pointed at before: still shown, as "Using <file>", but no
        # longer counted as missing while the chosen file is there.
        picks = app.state.catalog.pointed_for(str(p))
        missing = []
        for r in scan.missing:
            key = r.expected_path or r.name
            chosen = picks.get(key)
            if chosen and not (Path(chosen).is_file() and _allowed_external_file(Path(chosen))):
                chosen = None
            missing.append({"name": r.name, "expected_path": key,
                            "recoverable": key in recoverable, "pointed": chosen})
        return {
            "name": scan.name,
            "path": str(p),
            "present_count": sum(1 for r in scan.refs if r.exists),
            "missing_count": sum(1 for m in missing if not m["pointed"]),
            "pointed_count": sum(1 for m in missing if m["pointed"]),
            "recoverable_count": len(recoverable),
            "probed": bool(find),
            "missing": missing,
        }

    async def _run_job(job_id, sources, dest, timestamp, als_paths, label,
                       portable, layout, find_missing, libraries, mirrors, relink_map=None):
        hub = app.state.hub
        cat = app.state.catalog
        cancel = app.state.cancels[job_id]

        def progress(ev):
            hub.publish_threadsafe(ev)

        try:
            result = await asyncio.to_thread(
                run_backup, sources, dest, cat, timestamp, progress, als_paths,
                label, portable, layout, find_missing, libraries, cancel.is_set,
                mirrors, relink_map)
            app.state.jobs[job_id] = {"state": "done", "result": result}
            _refresh_pool_async(str(dest))  # the pool grew — recompute the cached size
        except Exception as e:  # pragma: no cover - defensive
            app.state.jobs[job_id] = {"state": "error", "error": str(e)}
        finally:
            app.state.cancels.pop(job_id, None)

    @app.post("/api/backup", dependencies=[Depends(require_token)])
    async def backup(req: BackupRequest):
        sources = _resolve_sources(req.sources)
        saved = app.state.catalog.get_setting("config") or {}
        dest = req.dest or saved.get("dest", "")
        if not dest:
            raise HTTPException(status_code=400, detail="Backups are off. Choose where to keep them in Settings first.")
        timestamp = req.timestamp or default_timestamp()
        # Free tier: Ableton only, and no auto-relink of missing samples.
        als_paths = req.als_paths
        if als_paths is not None and not _allows("multi_daw"):
            als_paths = [a for a in als_paths if str(a).lower().endswith(".als")]
        find_missing = req.find_missing and _allows("auto_relink")
        # Saved sample libraries + any one-off folder the user pointed at for THIS
        # run ("look in this folder"). Deduped, order-preserving — only consulted
        # when find_missing relinking is active.
        libraries = list(saved.get("libraries", []))
        for extra in (req.libraries or []):
            if extra and extra not in libraries:
                libraries.append(extra)
        # Exact per-file remaps the user pointed at ("this missing sample IS that
        # file"). Same auto_relink gating as the auto-finder — it's still a relink.
        relink_map = req.relink_map if find_missing else None
        # Remember each pick, so it still holds after the page is left and every later
        # backup of the project (scheduled ones too) uses the same file.
        if relink_map and als_paths:
            for a in als_paths:
                app.state.catalog.remember_pointed(str(a), relink_map)
        # offsite/cloud mirrors are a top-tier (Studio) feature
        mirrors = saved.get("mirrors", []) if _allows("cloud_backup") else []
        # bind the loop here so the worker thread's progress publishing works even
        # when the app is driven without a lifespan (e.g. bare TestClient).
        app.state.hub.bind_loop(asyncio.get_running_loop())
        job_id = uuid.uuid4().hex
        _new_job(job_id)
        app.state.cancels[job_id] = threading.Event()
        asyncio.create_task(
            _run_job(job_id, sources, Path(dest), timestamp, als_paths,
                     req.label, req.portable, req.layout, find_missing,
                     libraries, mirrors, relink_map))
        return {"job_id": job_id, "state": "running"}

    @app.get("/api/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str):
        job = app.state.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="unknown job")
        return job

    @app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(require_token)])
    def cancel_job(job_id: str):
        ev = app.state.cancels.get(job_id)
        if ev is None:
            raise HTTPException(status_code=404, detail="job not running")
        ev.set()  # checked between projects in run_backup
        # reflect 'cancelling' in status until _run_job writes the terminal result
        job = app.state.jobs.get(job_id)
        if job and job.get("state") == "running":
            app.state.jobs[job_id] = {"state": "cancelling"}
        return {"cancelling": True}

    @app.get("/api/overview", dependencies=[Depends(require_token)])
    async def overview():
        cfg = app.state.catalog.get_setting("config") or {}
        dest = cfg.get("dest", "")
        # build_overview reads cached figures (fast), but disk_usage on the NAS can
        # block briefly — keep it off the event loop.
        data = await asyncio.to_thread(build_overview, app.state.catalog, dest)
        # Returns instantly from cache; kick off a background walk if it's missing
        # or stale (>2 min) so the figures stay current without blocking the load.
        age = pool_cache_age(app.state.catalog)
        if dest and (age is None or age > 120):
            _refresh_pool_async(dest)
        interval = cfg.get("interval_minutes", 0) or 0
        data["schedule"] = {
            "enabled": interval > 0,
            "interval_minutes": interval,
            "next_run": app.state.scheduler.next_run(),
        }
        return data

    @app.get("/api/history", dependencies=[Depends(require_token)])
    def history(limit: int = 50):
        return {"snapshots": app.state.catalog.recent_snapshots(limit=limit)}

    @app.get("/api/projects", dependencies=[Depends(require_token)])
    def projects():
        rows = app.state.catalog.projects_summary()
        genres = project_genres(app.state.catalog)  # cached only — never blocks
        pending = 0
        for r in rows:
            g = genres.get(r["project_name"])
            if g:
                r.update(genre=g["genre"], genre_emoji=g["emoji"],
                         bpm=g["bpm"], genre_confidence=g["confidence"],
                         genre_pending=g["pending"])
                pending += 1 if g["pending"] else 0
        if pending:
            _backfill_genres_async()  # fill the rest in the background
        return {"projects": rows, "genres_pending": pending}

    @app.get("/api/projects/{name}", dependencies=[Depends(require_token)])
    def project_detail(name: str):
        cat = app.state.catalog
        cfg = cat.get_setting("config") or {}
        dest = cfg.get("dest", "")
        snaps = cat.snapshots_for(name)
        missing_by_id = cat.missing_for_snapshots([s["id"] for s in snaps])
        for s in snaps:
            s["missing"] = missing_by_id.get(s["id"], [])
            # Prefer the stored snapshot folder; fall back to the default layout for
            # rows written before we recorded it, so older backups still reveal.
            if not s.get("dir"):
                s["dir"] = (
                    str(Path(dest) / "AbletonBackups" / "projects" / name / s["timestamp"])
                    if dest else ""
                )
        return {"project_name": name, "snapshots": snaps}

    @app.get("/api/snapshot/{snapshot_id}/files", dependencies=[Depends(require_token)])
    def snapshot_files(snapshot_id: int):
        snap = app.state.catalog.get_snapshot(snapshot_id)
        if snap is None:
            raise HTTPException(status_code=404, detail="unknown snapshot")
        d = snap.get("dir")
        mf = Path(d) / "manifest.json" if d else None
        if not mf or not mf.is_file():
            return {"files": [], "manifest_present": False, "missing": snap.get("missing", [])}
        try:
            m = json.loads(mf.read_text())
        except (OSError, ValueError):
            return {"files": [], "manifest_present": False, "missing": []}
        return {
            "files": m.get("files", []),
            "manifest_present": True,
            "portable": m.get("portable"),
            "missing": m.get("missing", []),
            "total_size": m.get("total_size"),
        }

    @app.get("/api/snapshot/{snapshot_id}/diff", dependencies=[Depends(require_token)])
    def snapshot_changes(snapshot_id: int):
        cat = app.state.catalog
        snap = cat.get_snapshot(snapshot_id)
        if snap is None:
            raise HTTPException(status_code=404, detail="unknown snapshot")
        prev = None  # the most recent earlier snapshot of the SAME project with a folder
        pid = snap.get("project_id")
        for r in cat.snapshots_for(snap["project_name"]):
            # don't diff against a different project that merely shares a name
            if pid and r.get("project_id") and r.get("project_id") != pid:
                continue
            if r.get("dir") and r["timestamp"] < snap["timestamp"]:
                if prev is None or r["timestamp"] > prev["timestamp"]:
                    prev = r
        diff = snapshot_diff(snap.get("dir"), prev["dir"] if prev else None)
        diff["prev_timestamp"] = prev["timestamp"] if prev else None
        diff["is_first"] = prev is None
        return diff

    @app.post("/api/restore", dependencies=[Depends(require_token)])
    async def restore(req: RestoreRequest):
        if not _allows("restore"):
            raise HTTPException(status_code=402, detail="Restore is a Pro feature.")
        snap = app.state.catalog.get_snapshot(req.snapshot_id)
        if snap is None:
            raise HTTPException(status_code=404, detail="unknown snapshot")
        snap_dir = snap.get("dir")
        if not snap_dir:
            raise HTTPException(status_code=400, detail="snapshot has no recorded folder")
        target = _validate_target(req.target)
        job_id = uuid.uuid4().hex
        _new_job(job_id)

        async def _run_restore():
            try:
                path = await asyncio.to_thread(restore_snapshot, snap_dir, target)
                app.state.jobs[job_id] = {"state": "done", "result": {"path": path}}
            except Exception:
                app.state.jobs[job_id] = {"state": "error", "error": "restore failed"}

        asyncio.create_task(_run_restore())
        return {"job_id": job_id, "state": "running"}

    @app.post("/api/share", dependencies=[Depends(require_token)])
    async def share(req: RestoreRequest):
        # Share extracts a full snapshot to a folder — same capability as restore,
        # so it's gated the same way.
        if not _allows("restore"):
            raise HTTPException(status_code=402, detail="Sharing a backup is a Pro feature.")
        snap = app.state.catalog.get_snapshot(req.snapshot_id)
        if snap is None:
            raise HTTPException(status_code=404, detail="unknown snapshot")
        snap_dir = snap.get("dir")
        if not snap_dir:
            raise HTTPException(status_code=400, detail="snapshot has no recorded folder")
        target = _validate_target(req.target)
        job_id = uuid.uuid4().hex
        _new_job(job_id)

        async def _run_share():
            try:
                path = await asyncio.to_thread(share_snapshot, snap_dir, target)
                app.state.jobs[job_id] = {"state": "done", "result": {"path": path}}
            except Exception:
                app.state.jobs[job_id] = {"state": "error", "error": "could not create the zip"}

        asyncio.create_task(_run_share())
        return {"job_id": job_id, "state": "running"}

    @app.get("/api/verify/{snapshot_id}", dependencies=[Depends(require_token)])
    def verify(snapshot_id: int):
        cat = app.state.catalog
        snap = cat.get_snapshot(snapshot_id)
        if snap is None:
            raise HTTPException(status_code=404, detail="unknown snapshot")
        snap_dir = snap.get("dir")
        if not snap_dir:
            raise HTTPException(status_code=400, detail="snapshot has no recorded folder")
        # Deep (byte re-hash) verify is a Pro feature; Free gets the basic check.
        result = verify_snapshot(snap_dir, deep=_allows("deep_verify"))
        new_status = "error" if not result["ok"] else None
        cat.set_verified(snapshot_id, 1 if result["ok"] else 0,
                         default_timestamp(), status=new_status)
        return result

    @app.websocket("/ws/progress")
    async def ws_progress(websocket: WebSocket, token: str = ""):
        if not ws_token_ok(app, token):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        app.state.hub.bind_loop(asyncio.get_running_loop())
        q = app.state.hub.subscribe()
        try:
            while True:
                event = await q.get()
                await websocket.send_json(event)
        except WebSocketDisconnect:
            pass
        finally:
            app.state.hub.unsubscribe(q)

    return app
