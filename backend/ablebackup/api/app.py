"""FastAPI application factory for the backup sidecar."""
import asyncio
import json
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from ablebackup import entitlement
from ablebackup.api.auth import require_token, ws_token_ok
from ablebackup.api.progress import ProgressHub
from ablebackup.api.schemas import ActivateRequest, BackupRequest, Config, RestoreRequest, ScanRequest
from ablebackup.catalog import Catalog
from ablebackup.scheduler import BackupScheduler
from ablebackup.service import (
    build_overview, default_timestamp, pool_cache_age, rclone_available,
    rclone_remotes, refresh_pool_cache, restore_snapshot, run_backup, scan_summary,
    share_snapshot, snapshot_diff,
)
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
    app.state.cancels = {}  # job_id -> threading.Event, to cancel a running backup
    app.state.pool_refreshing = False  # guard so only one pool-size walk runs at a time
    app.state.pool_task = None          # keep a ref so the task isn't GC'd mid-run

    def _refresh_pool_async(dest: str):
        """Recompute the cached pool size off the event loop, without overlapping."""
        if not dest or app.state.pool_refreshing:
            return

        async def _run():
            app.state.pool_refreshing = True
            try:
                await asyncio.to_thread(refresh_pool_cache, app.state.catalog, dest)
            finally:
                app.state.pool_refreshing = False

        app.state.pool_task = asyncio.create_task(_run())

    @app.get("/health")
    def health():
        return {"status": "ok"}

    def _tier() -> str:
        # verify_stored rejects a hand-edited/forged entitlement row -> 'free'.
        return entitlement.verify_stored(app.state.catalog.get_setting("entitlement") or {})

    def _allows(feature: str) -> bool:
        return entitlement.allows(_tier(), feature)

    @app.get("/api/rclone", dependencies=[Depends(require_token)])
    def rclone_info():
        return {"available": rclone_available(), "remotes": rclone_remotes()}

    @app.get("/api/entitlement", dependencies=[Depends(require_token)])
    def get_entitlement():
        tier = _tier()
        return {"tier": tier, "features": entitlement.features_for(tier)}

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

    @app.get("/api/settings", dependencies=[Depends(require_token)])
    def get_settings() -> Config:
        saved = app.state.catalog.get_setting("config")
        return Config(**saved) if saved else Config()

    @app.put("/api/settings", dependencies=[Depends(require_token)])
    def put_settings(config: Config) -> Config:
        if config.interval_minutes > 0 and not _allows("scheduled"):
            config.interval_minutes = 0  # automatic backup is Pro-only
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

        find_missing = req.find_missing and _allows("auto_relink")
        projects = scan_summary(
            sources, progress=progress, find_missing=find_missing,
            libraries=cfg.get("libraries", []))
        if not _allows("multi_daw"):
            projects = [p for p in projects if p.get("daw") == "ableton"]
        return {"projects": projects}

    async def _run_job(job_id, sources, dest, timestamp, als_paths, label,
                       portable, layout, find_missing, libraries, mirrors):
        hub = app.state.hub
        cat = app.state.catalog
        cancel = app.state.cancels[job_id]

        def progress(ev):
            hub.publish_threadsafe(ev)

        try:
            result = await asyncio.to_thread(
                run_backup, sources, dest, cat, timestamp, progress, als_paths,
                label, portable, layout, find_missing, libraries, cancel.is_set,
                mirrors)
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
            raise HTTPException(status_code=400, detail="no destination configured")
        timestamp = req.timestamp or default_timestamp()
        # Free tier: Ableton only, and no auto-relink of missing samples.
        als_paths = req.als_paths
        if als_paths is not None and not _allows("multi_daw"):
            als_paths = [a for a in als_paths if str(a).lower().endswith(".als")]
        find_missing = req.find_missing and _allows("auto_relink")
        # offsite/cloud mirrors are a top-tier (Studio) feature
        mirrors = saved.get("mirrors", []) if _allows("cloud_backup") else []
        # bind the loop here so the worker thread's progress publishing works even
        # when the app is driven without a lifespan (e.g. bare TestClient).
        app.state.hub.bind_loop(asyncio.get_running_loop())
        job_id = uuid.uuid4().hex
        app.state.jobs[job_id] = {"state": "running"}
        app.state.cancels[job_id] = threading.Event()
        asyncio.create_task(
            _run_job(job_id, sources, Path(dest), timestamp, als_paths,
                     req.label, req.portable, req.layout, find_missing,
                     saved.get("libraries", []), mirrors))
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
        return {"projects": app.state.catalog.projects_summary()}

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
        job_id = uuid.uuid4().hex
        app.state.jobs[job_id] = {"state": "running"}

        async def _run_restore():
            try:
                path = await asyncio.to_thread(restore_snapshot, snap_dir, req.target)
                app.state.jobs[job_id] = {"state": "done", "result": {"path": path}}
            except Exception as e:
                app.state.jobs[job_id] = {"state": "error", "error": str(e)}

        asyncio.create_task(_run_restore())
        return {"job_id": job_id, "state": "running"}

    @app.post("/api/share", dependencies=[Depends(require_token)])
    async def share(req: RestoreRequest):
        snap = app.state.catalog.get_snapshot(req.snapshot_id)
        if snap is None:
            raise HTTPException(status_code=404, detail="unknown snapshot")
        snap_dir = snap.get("dir")
        if not snap_dir:
            raise HTTPException(status_code=400, detail="snapshot has no recorded folder")
        job_id = uuid.uuid4().hex
        app.state.jobs[job_id] = {"state": "running"}

        async def _run_share():
            try:
                path = await asyncio.to_thread(share_snapshot, snap_dir, req.target)
                app.state.jobs[job_id] = {"state": "done", "result": {"path": path}}
            except Exception as e:
                app.state.jobs[job_id] = {"state": "error", "error": str(e)}

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
        result = verify_snapshot(snap_dir, deep=True)
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
