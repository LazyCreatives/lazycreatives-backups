# ablebackup engine

Plan 1 of the Ableton Project Backup Tool: the standalone backup engine + CLI.

## Usage

    python -m ablebackup.cli scan --source "C:\Users\me\Music\Ableton"

    python -m ablebackup.cli backup \
        --source "C:\Users\me\Music\Ableton" \
        --dest "Z:\\" \
        --db "%LOCALAPPDATA%\ablebackup\catalog.db"

`scan` lists discovered projects and how many referenced files exist / are missing.
`backup` writes a deduplicated dated snapshot of every project under
`<dest>/AbletonBackups/projects/<Project>/<timestamp>/` and records history in the catalog DB.

## What it does / does not do

- Resolves every sample reference in each `.als` (relative + absolute, modern + legacy formats),
  copies the complete self-contained project, and flags any missing files.
- Dedups identical files across snapshots via a content pool + hardlinks (falls back to copies
  on filesystems without hardlink support).
- Does NOT back up plugins/VSTs (installed software). Does NOT render stems.

## API sidecar (Plan 2)

Run the localhost engine server (the future Electron app spawns this):

    $env:ABLEBACKUP_TOKEN="<shared-token>"   # PowerShell; omit to disable auth
    python -m ablebackup.server               # binds 127.0.0.1:8753

Endpoints (all under `/api` require header `X-Auth-Token: <token>`):

- `GET  /health` — liveness, no auth
- `GET/PUT /api/settings` — persisted config: `sources[]`, `dest`, `interval_minutes`
- `POST /api/scan` — `{sources?}` → discovered projects with present/missing counts
- `POST /api/backup` — `{sources?, dest?, timestamp?}` → `{job_id}`; runs in background
- `GET  /api/jobs/{id}` — poll backup job state/result
- `GET  /api/history` — recent snapshots (date-indexed view)
- `GET  /api/projects`, `GET /api/projects/{name}` — per-project browse
- `WS   /ws/progress?token=<token>` — live backup progress events

Setting `interval_minutes > 0` enables an APScheduler job that re-runs the saved
config automatically while the server is running.

Env vars: `ABLEBACKUP_TOKEN` (shared auth token), `ABLEBACKUP_PORT` (default 8753),
`ABLEBACKUP_DB` (catalog path, default `%LOCALAPPDATA%\ablebackup\catalog.db`).

Next plan: the Electron shell + web UI that drives these endpoints.
