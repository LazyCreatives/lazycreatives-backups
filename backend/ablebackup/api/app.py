"""FastAPI application factory for the backup sidecar."""
import asyncio
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from ablebackup.api.auth import require_token, ws_token_ok
from ablebackup.api.progress import ProgressHub
from ablebackup.api.schemas import BackupRequest, Config, ScanRequest
from ablebackup.catalog import Catalog
from ablebackup.scheduler import BackupScheduler
from ablebackup.service import build_overview, default_timestamp, run_backup, scan_summary


def create_app(token: str, db_path: Path) -> FastAPI:
    catalog = Catalog(Path(db_path))
    hub = ProgressHub()
    scheduler = BackupScheduler(catalog)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.bind_loop(asyncio.get_running_loop())
        saved = catalog.get_setting("config") or {}
        scheduler.set_interval(saved.get("interval_minutes", 0))
        yield
        scheduler.shutdown()
        catalog.close()

    app = FastAPI(title="ablebackup", lifespan=lifespan)
    # The Electron renderer runs at a different origin (dev: http://localhost:5173,
    # packaged: file://) than the sidecar, so the browser sends CORS preflight
    # OPTIONS requests. Auth is via the X-Auth-Token header (not cookies), so it is
    # safe to allow all origins on this localhost-only server.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.token = token
    app.state.catalog = catalog
    app.state.hub = hub
    app.state.scheduler = scheduler
    app.state.jobs = {}

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/settings", dependencies=[Depends(require_token)])
    def get_settings() -> Config:
        saved = app.state.catalog.get_setting("config")
        return Config(**saved) if saved else Config()

    @app.put("/api/settings", dependencies=[Depends(require_token)])
    def put_settings(config: Config) -> Config:
        app.state.catalog.set_setting("config", config.model_dump())
        app.state.scheduler.set_interval(config.interval_minutes)
        return config

    def _resolve_sources(supplied):
        if supplied:
            return [Path(s) for s in supplied]
        saved = app.state.catalog.get_setting("config") or {}
        return [Path(s) for s in saved.get("sources", [])]

    @app.post("/api/scan", dependencies=[Depends(require_token)])
    def scan(req: ScanRequest):
        sources = _resolve_sources(req.sources)
        cfg = app.state.catalog.get_setting("config") or {}
        hub = app.state.hub

        def progress(ev):
            try:
                hub.publish_threadsafe(ev)
            except RuntimeError:
                pass  # no event loop bound (e.g. bare TestClient) — skip live ticks

        return {"projects": scan_summary(
            sources, progress=progress, find_missing=req.find_missing,
            libraries=cfg.get("libraries", []))}

    async def _run_job(job_id, sources, dest, timestamp, als_paths, label,
                       portable, layout, find_missing, libraries):
        hub = app.state.hub
        cat = app.state.catalog

        def progress(ev):
            hub.publish_threadsafe(ev)

        try:
            result = await asyncio.to_thread(
                run_backup, sources, dest, cat, timestamp, progress, als_paths,
                label, portable, layout, find_missing, libraries)
            app.state.jobs[job_id] = {"state": "done", "result": result}
        except Exception as e:  # pragma: no cover - defensive
            app.state.jobs[job_id] = {"state": "error", "error": str(e)}

    @app.post("/api/backup", dependencies=[Depends(require_token)])
    async def backup(req: BackupRequest):
        sources = _resolve_sources(req.sources)
        saved = app.state.catalog.get_setting("config") or {}
        dest = req.dest or saved.get("dest", "")
        if not dest:
            raise HTTPException(status_code=400, detail="no destination configured")
        timestamp = req.timestamp or default_timestamp()
        # bind the loop here so the worker thread's progress publishing works even
        # when the app is driven without a lifespan (e.g. bare TestClient).
        app.state.hub.bind_loop(asyncio.get_running_loop())
        job_id = uuid.uuid4().hex
        app.state.jobs[job_id] = {"state": "running"}
        asyncio.create_task(
            _run_job(job_id, sources, Path(dest), timestamp, req.als_paths,
                     req.label, req.portable, req.layout, req.find_missing,
                     saved.get("libraries", [])))
        return {"job_id": job_id, "state": "running"}

    @app.get("/api/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str):
        job = app.state.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="unknown job")
        return job

    @app.get("/api/overview", dependencies=[Depends(require_token)])
    def overview():
        cfg = app.state.catalog.get_setting("config") or {}
        data = build_overview(app.state.catalog, cfg.get("dest", ""))
        interval = cfg.get("interval_minutes", 0) or 0
        data["schedule"] = {"enabled": interval > 0, "interval_minutes": interval}
        return data

    @app.get("/api/history", dependencies=[Depends(require_token)])
    def history(limit: int = 50):
        return {"snapshots": app.state.catalog.recent_snapshots(limit=limit)}

    @app.get("/api/projects", dependencies=[Depends(require_token)])
    def projects():
        return {"projects": app.state.catalog.projects_summary()}

    @app.get("/api/projects/{name}", dependencies=[Depends(require_token)])
    def project_detail(name: str):
        cat = app.state.catalog
        cfg = cat.get_setting("config") or {}
        dest = cfg.get("dest", "")
        snaps = cat.snapshots_for(name)
        for s in snaps:
            s["missing"] = cat.missing_for(s["id"])
            # Prefer the stored snapshot folder; fall back to the default layout for
            # rows written before we recorded it, so older backups still reveal.
            if not s.get("dir"):
                s["dir"] = (
                    str(Path(dest) / "AbletonBackups" / "projects" / name / s["timestamp"])
                    if dest else ""
                )
        return {"project_name": name, "snapshots": snaps}

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
