<p align="center">
  <img src="brand/logo.png" alt="Lazy Creatives — Backups" width="380">
</p>

<h1 align="center">Lazy Creatives — Backups</h1>

<p align="center"><b>Verified, deduplicated backups for your music projects — that you own.</b></p>

<p align="center">
  <a href="https://lazycreatives.github.io">Website</a> ·
  <a href="https://lazycreatives.github.io/lazycreatives-backups/">Product page</a> ·
  <a href="https://lazycreatives.github.io/lazycreatives-backups/pricing.html">Pricing</a> ·
  <a href="https://github.com/LazyCreatives/lazycreatives-uploader">Sibling tool: Uploader</a>
</p>

Point it at your project folders and it finds every session (Ableton & FL Studio),
follows each one's samples, copies complete de-duplicated snapshots to your own
NAS/drive, then **re-reads and re-hashes every file to prove the backup actually
opens**. No cloud, no account — you own the storage.

> Cloud DAW-sync tools can't make these claims structurally. This can.

Part of [**Lazy Creatives**](https://lazycreatives.github.io) — tools that take the boring,
behind-the-scenes work of making music off your plate. *Looks lazy. Works obsessively.*

---

## Why

- **Your samples never go missing.** It resolves every referenced sample, and if
  one isn't where the project points, it relinks the *right* file from your
  library (verified by recorded size, not just filename — so it never silently
  backs up a different same-named sample).
- **Backups are verified, not just copied.** Each snapshot ships a manifest of
  every file + content hash; after writing, it re-reads the snapshot to confirm
  nothing was truncated, and you can deep-**Verify** any snapshot on demand
  (re-hashes every byte, and checks the project would open standalone).
- **Space-efficient.** A content-addressed pool + hardlinks mean each dated
  snapshot is a full, openable project but only costs the bytes that changed.
- **Only snapshots when something changed** — no redundant history.
- **Multi-DAW.** Ableton today, FL Studio today, more by adding one adapter.

## Supported DAWs

| DAW | Format | Status |
|---|---|---|
| Ableton Live | `.als` (gzip + XML) | ✅ full — records sample size for high-confidence relink |
| FL Studio | `.flp` (binary) | ✅ via a dependency-free clean-room reader (works across FL versions) |
| Reaper / Logic / Studio One / Bitwig | — | planned (each is one adapter) |

## How it works

```
Setup (once)  →  Scan  →  Review  →  Back up  →  Verify
 folders+NAS      find     pick &     dedup +     re-read &
                  all      relink     snapshot    re-hash
```

Backups land per-DAW on your destination:

```
<NAS>/AbletonBackups/   projects/<name>/<YYYY-MM-DD_HHMM>/   + _pool/  + manifest.json
<NAS>/FLStudioBackups/  projects/<name>/<YYYY-MM-DD_HHMM>/   + _pool/  + manifest.json
```

## Architecture

An **Electron** shell + React/TypeScript renderer over a **Python/FastAPI**
sidecar that does all the file/parse/backup/verify work.

```
electron/   desktop shell + flow-first UI (Setup → Home → inline Scan/Review/Run → History)
backend/    ablebackup/ — the engine
  daws/         per-DAW adapters (Ableton, FL Studio) behind one registry
  scanner       discover + resolve projects (dispatches by file type)
  resolver      resolve sample refs to disk; relink missing from libraries
  backup_engine dedup pool, hardlinks, atomic snapshots, manifest
  verifier      re-read + re-hash a snapshot; portability check
  catalog       SQLite history
```

Adding a DAW = one adapter (discover + parse-to-FileRefs) + one registry line; the
engine, dedup, verify, catalog and relink are reused unchanged.

## Develop / run

Prereqs: Node 18+, Python 3.11+.

```bash
# backend
cd backend && python -m venv .venv && .venv/bin/pip install -e ".[dev]"

# app (spawns the sidecar automatically)
cd ../electron && npm install && npm start
```

## Tests

```bash
cd backend  && .venv/bin/python -m pytest        # 102 backend tests
cd electron && npm test                          # renderer (api + progress + lifecycle)
```

## Status

Active development — pre-launch. Packaging (installers) isn't wired up yet; `npm start`
runs it in dev. Star the repo to hear when it ships, or see
[lazycreatives.github.io](https://lazycreatives.github.io/) for downloads.
