# Picture tests

These tests start the real LazyCreatives Backups app (Electron, with its own Python
backend), open each main screen, take a picture of it, and compare that picture with
a saved one. If a screen now looks different, the test fails and shows you the
difference. They catch layout and styling changes you did not mean to make.

## What they do

1. Build the page (`vite build`, into `dist/`).
2. Make a fake home folder with a made-up music library in it (34 projects for
   Ableton, FL Studio and REAPER, some exported songs, a few missing samples), in a
   scratch folder in your temp folder. Your own music and app data are never touched.
3. Start the app with Playwright. The backend runs from `../backend` with your
   Python, and all app data goes into the scratch folder.
4. Take a picture of the first-run welcome, then fill the library (folders, a scan,
   one backup) and take pictures of **Home**, **Library**, **Dig** and **Settings**.
5. Do all of that in both looks, **crate** and **sleeve**. The look is set the same
   way the app keeps it: `lc-look` in the page's localStorage (see `src/look.ts`).

Things that change from run to run are covered with a solid box before the picture
is taken: dates and times, "last backup" times, waveforms and meters, and folder
paths. Animations are switched off for the picture.

The pictures are of the page inside the window only. Native window parts do **not**
appear: no title bar or its buttons, no window frame or shadow, no Mica (Windows) or
vibrancy (Mac) see-through effects, no menu bar, no tray icon.

## Run them

One-time setup, from the repo root:

```bash
cd electron && npm ci
cd ../backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
```

(On Windows the venv's Python is `backend\.venv\Scripts\python.exe`; it is found by
itself.)

Then, from `electron/`:

```bash
npm run test:screens
```

On Linux without a screen (a server, CI), wrap it in a virtual one:

```bash
xvfb-run -a -s "-screen 0 1440x900x24" npm run test:screens
```

A run takes about a minute. When something differs, open the report:

```bash
npx playwright show-report e2e/playwright-report
```

It shows the saved picture, the new one, and the difference side by side.

## Update the saved pictures

When a screen changed on purpose, save new pictures and commit them:

```bash
npm run test:screens:update
```

Look at the new pictures in `e2e/__screenshots__/` before you commit them.

Each platform keeps its own set (`__screenshots__/linux`, `win32`, `darwin`), because
fonts and scrollbars are drawn a little differently on each. Update a platform's set
on that platform. The Linux set was made on a Linux machine with Xvfb; if the CI
runner draws text slightly differently, take the new pictures from the failed CI
run's report and commit those.

## Settings you can change

| Variable          | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `E2E_PYTHON`      | Python to run the backend with (default: `backend/.venv`, then `python3`) |
| `E2E_SKIP_BUILD=1`| Skip `vite build` when `dist/` is already up to date                |
| `E2E_WORK_DIR`    | Scratch folder (default: `<temp>/lazycreatives-backups-screens`)    |
| `E2E_VERBOSE=1`   | Print the app's and backend's own output                            |

## Files

- `playwright.config.ts`: where pictures are kept, how close a match must be.
- `global-setup.ts`: builds the page and makes the fake library.
- `app.ts`: starts and stops the app.
- `main-hook.cjs`: loaded into the app only during these tests; keeps app data in
  the scratch folder and loads the built page instead of a dev server.
- `screens.spec.ts`: the screens and looks to take pictures of.
- `fixtures/seed_library.py`: makes the fake music library (Python, nothing to install).

`npm test` (the unit tests) does not run these. Type-check them with
`npx tsc --noEmit -p e2e`.
