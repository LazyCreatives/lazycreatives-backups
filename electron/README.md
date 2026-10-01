# Ableton Backup — desktop app

Electron shell + React UI over the `ablebackup` Python sidecar (Plan 3).

## Prerequisites
- Node 18+ and Python 3.11+ with the backend installed:
  `cd ../backend && python -m pip install -e ".[dev]"`

## Develop / run
    cd electron
    npm install
    npm start        # launches Vite + Electron; spawns the python sidecar

The app mints an auth token + port, starts `python -m ablebackup.server` with them,
waits for `/health`, and drives it over HTTP + WebSocket. Settings, scans, backups,
live progress, history browsing, and scheduling are all in the UI. The window hides
to the tray so scheduled backups keep running; Tray → Quit stops everything.

## Tests
    npm test         # renderer unit tests (api client + progress reducer)

## Packaging (later)
Not yet wired. A future step bundles the Python backend (PyInstaller) into
`resources/backend` and builds installers with electron-builder.
