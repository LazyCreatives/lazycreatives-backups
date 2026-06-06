"""FastAPI application factory for the backup sidecar."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI

from ablebackup.api.auth import require_token
from ablebackup.api.progress import ProgressHub
from ablebackup.api.schemas import Config
from ablebackup.catalog import Catalog


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

    return app
