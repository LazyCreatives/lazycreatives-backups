"""FastAPI application factory for the backup sidecar."""
import asyncio
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException

from ablebackup.api.auth import require_token
from ablebackup.api.progress import ProgressHub
from ablebackup.api.schemas import BackupRequest, Config, ScanRequest
from ablebackup.catalog import Catalog
from ablebackup.service import default_timestamp, run_backup, scan_summary


def create_app(token: str, db_path: Path) -> FastAPI:
    catalog = Catalog(Path(db_path))
    hub = ProgressHub()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.bind_loop(asyncio.get_running_loop())
        yield
        catalog.close()

    app = FastAPI(title="ablebackup", lifespan=lifespan)
    app.state.token = token
    app.state.catalog = catalog
    app.state.hub = hub
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
        return config

    def _resolve_sources(supplied):
        if supplied:
            return [Path(s) for s in supplied]
        saved = app.state.catalog.get_setting("config") or {}
        return [Path(s) for s in saved.get("sources", [])]

    @app.post("/api/scan", dependencies=[Depends(require_token)])
    def scan(req: ScanRequest):
        sources = _resolve_sources(req.sources)
        return {"projects": scan_summary(sources)}

    async def _run_job(job_id, sources, dest, timestamp):
        hub = app.state.hub
        cat = app.state.catalog

        def progress(ev):
            hub.publish_threadsafe(ev)

        try:
            result = await asyncio.to_thread(
                run_backup, sources, dest, cat, timestamp, progress)
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
        asyncio.create_task(_run_job(job_id, sources, Path(dest), timestamp))
        return {"job_id": job_id, "state": "running"}

    @app.get("/api/jobs/{job_id}", dependencies=[Depends(require_token)])
    def job_status(job_id: str):
        job = app.state.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="unknown job")
        return job

    return app
