// Starting and stopping the real app for the picture tests.
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { stubAllDialogs } from "electron-playwright-helpers";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const ELECTRON_DIR = path.resolve(__dirname, "..");
export const BACKEND_DIR = path.resolve(ELECTRON_DIR, "..", "backend");

// One fixed scratch folder per app (wiped at the start of every run), so paths
// shown on screen are the same from one run to the next.
export const WORK_DIR = process.env.E2E_WORK_DIR || path.join(tmpdir(), "lazycreatives-backups-screens");
export const FAKE_HOME = path.join(WORK_DIR, "home");

// The backend's Python: E2E_PYTHON, else backend/.venv, else python3 / python.
export function python(): string {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  const venv = process.platform === "win32"
    ? path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe")
    : path.join(BACKEND_DIR, ".venv", "bin", "python");
  if (existsSync(venv)) return venv;
  return process.platform === "win32" ? "python" : "python3";
}

// Window size used for every picture (the app's own default size).
export const WINDOW = { width: 1100, height: 760 };

export interface RunningApp { app: ElectronApplication; page: Page; port: string; token: string; version: string }

export async function launchApp(): Promise<RunningApp> {
  const userData = path.join(WORK_DIR, "user-data");
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(path.join(WORK_DIR, "data"), { recursive: true });

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RUN_AS_NODE; // a host editor running under Electron sets this
  Object.assign(env, {
    ABLEBACKUP_DEV: "1",                       // run the backend from ../backend with Python
    ABLEBACKUP_PYTHON: python(),
    ABLEBACKUP_DB: path.join(WORK_DIR, "data", "catalog.db"),
    ABLEBACKUP_UPLOADER_DB: path.join(WORK_DIR, "no-uploader.db"),  // no Uploader on this "computer"
    LC_ALBUMS_DB: path.join(WORK_DIR, "data", "albums.db"),           // the albums list shared with Uploader
    // The backend looks for music folders in the home folder: point it at the fake one.
    HOME: FAKE_HOME, USERPROFILE: FAKE_HOME,
    E2E_USER_DATA: userData,
    TZ: "UTC",
  });

  const app = await electron.launch({
    args: ["-r", path.join(__dirname, "main-hook.cjs"), ELECTRON_DIR],
    cwd: ELECTRON_DIR,
    env,
    timeout: 120_000,
  });
  app.process().stdout?.on("data", (d) => { if (process.env.E2E_VERBOSE) process.stdout.write(d); });
  app.process().stderr?.on("data", (d) => { if (process.env.E2E_VERBOSE) process.stderr.write(d); });
  await stubAllDialogs(app); // an unexpected dialog must never hang the run

  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState("domcontentloaded");
  // Same window size on every machine, whatever size the screen is.
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setContentSize(size.width, size.height);
  }, WINDOW);
  await page.setViewportSize(WINDOW);
  const { port, token } = await page.evaluate(() => {
    const b = (window as unknown as { ablebackup: { port: string; token: string } }).ablebackup;
    return { port: b.port, token: b.token };
  });
  const version = await app.evaluate(({ app }) => app.getVersion());
  return { app, page, port, token, version };
}

// Change the window's size (the narrow-window pictures), keeping it the same on every machine.
export async function resizeWindow(running: RunningApp, size: { width: number; height: number }): Promise<void> {
  await running.app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height);
  }, size);
  await running.page.setViewportSize(size);
}

export async function closeApp(running: RunningApp | undefined): Promise<void> {
  if (!running) return;
  // The app hides to the tray when its window closes; quit it outright.
  await running.app.evaluate(({ app }) => app.quit()).catch(() => {});
  await running.app.close().catch(() => {});
}
