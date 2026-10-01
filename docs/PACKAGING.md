# Packaging LazyCreatives Backups into a real app

Turns the dev project (`npm start`) into a double-click installer. The app is an
Electron shell over a Python/FastAPI **sidecar**; packaging = freeze the sidecar
with **PyInstaller**, then wrap everything with **electron-builder**.

The wiring is already in place:
- `backend/sidecar.spec` — PyInstaller build of the sidecar (`ablebackup-sidecar`).
- `backend/ablebackup/server.py` calls `multiprocessing.freeze_support()` so the
  parallel-scan process pool works inside the frozen binary.
- `electron/electron/main.js` runs the bundled sidecar binary when `app.isPackaged`
  (and `python -m ablebackup.server` in dev — unchanged).
- `electron/package.json` → `build` block (electron-builder config) + `dist` script
  + `extraResources` copying the PyInstaller output into `Resources/sidecar`.

## Build (unsigned — works today, no accounts needed)

```bash
# 1. freeze the sidecar
cd backend
.venv/bin/pip install pyinstaller
.venv/bin/pyinstaller sidecar.spec --noconfirm --distpath dist
#    -> backend/dist/ablebackup-sidecar/ablebackup-sidecar

# 2. build the app (vite build + electron-builder)
cd ../electron
npm install            # pulls electron-builder (added to devDependencies)
npm run dist
#    -> electron/release/LazyCreatives Backups-0.1.0.dmg  (unsigned)
```

An **unsigned** `.dmg` is fine for your own testing and beta testers (they
right-click → Open the first time, or run `xattr -dr com.apple.quarantine` on the
app). For a public download you need signing + notarization (below).

> First build will need iteration — PyInstaller sometimes misses a hidden import
> (symptom: the sidecar binary exits immediately / health never comes up). Run the
> binary directly to see the error: `backend/dist/ablebackup-sidecar/ablebackup-sidecar`
> with `ABLEBACKUP_TOKEN=x ABLEBACKUP_PORT=8770 ABLEBACKUP_DB=/tmp/t.db`, then add the
> missing module to `hiddenimports` in `sidecar.spec`.

## Installers in CI (Windows, macOS, Linux)

`.github/workflows/installers.yml` builds **unsigned** installers on demand (Actions →
"installers" → Run workflow), on PRs that touch packaging files
(`electron/package.json`, `backend/sidecar.spec`, the workflow itself), and on `v*` tags. Each OS job
freezes the sidecar, checks the frozen binary answers `/health`, runs `vite build` +
`electron-builder`, and uploads the result as a build artifact:

| Artifact | File | Notes |
|---|---|---|
| `lazycreatives-backups-windows` | `LazyCreatives Backups Setup <ver>.exe` | SmartScreen warns: "More info" → "Run anyway". |
| `lazycreatives-backups-macos-arm64` | `LazyCreatives Backups-<ver>-arm64.dmg` | Apple Silicon only. Ad-hoc signed (no Apple account); after copying it to Applications run `xattr -dr com.apple.quarantine "/Applications/LazyCreatives Backups.app"` after copying it in. |
| `lazycreatives-backups-linux` | `LazyCreatives Backups-<ver>.AppImage` | `chmod +x` then run. |

**Publishing a release:** bump `version` in `electron/package.json`, merge, then push
a matching tag (`git tag v0.1.0 && git push origin v0.1.0`). The release job only runs
on the public repo (it is skipped when the repo name ends in `-dev`), where it builds
all three installers and publishes a GitHub Release with fixed asset names, so these
links always point at the newest release:

- `https://github.com/LazyCreatives/lazycreatives-backups/releases/latest/download/LazyCreatives-Backups-Windows-Setup.exe`
- `https://github.com/LazyCreatives/lazycreatives-backups/releases/latest/download/LazyCreatives-Backups-macOS-arm64.dmg`
- `https://github.com/LazyCreatives/lazycreatives-backups/releases/latest/download/LazyCreatives-Backups-Linux-x86_64.AppImage`

Releases are published as normal (not pre-release) so `releases/latest` finds them.

Set the `ABLEBACKUP_ENT_SECRET` repo secret (on the public repo, since that is where
releases are built) to sign entitlements with a stable key; without it each build uses
a throwaway one.

## License-signing secret (required for release builds)

The repo is public, so the in-source `_ENT_SECRET` fallback is intentionally NOT a
secret. Before building a release, inject a private signing key so locally-cached
entitlements aren't signed with the public default:

```bash
cd backend
python -c "import secrets,pathlib; pathlib.Path('ablebackup/_buildsecret.py').write_text('ENT_SECRET = %r\n' % secrets.token_hex(32))"
#  -> ablebackup/_buildsecret.py  (git-ignored; PyInstaller bundles it)
```

Or set `ABLEBACKUP_ENT_SECRET` in the build environment instead. Rotating this value
invalidates previously-issued local entitlements — users just re-activate (the real
gate is online activation, not this signature).

## Signing + notarization (needs the Apple Developer account — $99/yr)

Once enrolled:
```bash
export CSC_LINK=/path/to/DeveloperID.p12   # or use the keychain identity
export CSC_KEY_PASSWORD=…
export APPLE_ID=…  APPLE_APP_SPECIFIC_PASSWORD=…  APPLE_TEAM_ID=…
cd electron && npm run dist          # electron-builder signs + notarizes the .dmg
```
The `build.mac` block already sets `hardenedRuntime: true`; add an
`entitlements.mac.plist` if a dependency needs JIT/network exceptions. Windows
signing uses a separate cert (or Azure Trusted Signing) via `CSC_LINK` too.

## Auto-update (later)
Add **electron-updater** pointed at GitHub Releases (you already host there).
Gate updates by the license's `valid_until` for the Updates Pass (see
`brand/business/paywall-eng-scope.md` §5).

## Checklist
- [ ] `pyinstaller sidecar.spec` produces a sidecar that boots (`/health` 200).
- [ ] `npm run dist` produces a `.dmg` that launches and reaches the dashboard.
- [ ] Verify a real backup works from the packaged app (paths/permissions differ).
- [ ] Apple Developer enrolled → signed + notarized build.
- [ ] electron-updater + a Releases-based update feed.
