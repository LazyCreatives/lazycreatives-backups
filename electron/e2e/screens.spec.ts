// Picture tests for LazyCreatives Backups: start the real app, then take a picture
// of each main screen in both looks and compare it with the saved one.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { utimesSync } from "node:fs";
import path from "node:path";
import { FAKE_HOME, WORK_DIR, closeApp, launchApp, type RunningApp } from "./app";

const LOOKS = ["crate", "sleeve"] as const;
type Look = (typeof LOOKS)[number];
const SCREENS = ["home", "library", "dig", "plugins", "settings"] as const;

let running: RunningApp | undefined;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { running = await launchApp(); });
test.afterAll(async () => { await closeApp(running); });

// Open the app on `tab` in `look`: both are read from localStorage when the page loads
// (lc-look: see src/look.ts; lc-last-page: the page the app reopens on).
async function open(look: Look, tab: string): Promise<Page> {
  const { page, version } = running!;
  await page.evaluate(([l, t, v]) => {
    localStorage.setItem("lc-look", l);
    localStorage.setItem("lc-last-page", JSON.stringify(t));
    localStorage.setItem("lc_onboarded", "1");     // the one-time "first backup done" note
    localStorage.setItem("lc-seen-version", v);    // "What's new" already read
  }, [look, tab, version] as const);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-look", look);
  await settle(page);
  return page;
}

// Wait until loading is over and the page has stopped changing.
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500); // count-ups and entrance animations finish
}

// Things that change from run to run: times and dates, the moving level meters
// and waveforms, and folder paths (the scratch folder differs per computer).
function changing(page: Page): Locator[] {
  return [
    page.locator("time"),
    page.locator("canvas"),
    page.locator("[class*='meter'], [class*='Meter']"),
    page.locator("[class*='wave'], [class*='Wave']"),
    page.locator("[class*='date'], [class*='when'], [class*='ago'], [class*='next']"),
    page.locator("[class*='path'], [title^='/'], [title*=':\\\\']"),
    page.getByText(/\b(\d{1,2}:\d{2}|today|yesterday|ago|tomorrow)\b/i),
  ];
}

async function snap(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: changing(page), fullPage: false });
}

// Fill the backend through its own API the way a user would through the app:
// project folders and a backup drive, a scan, the exported songs, one backup,
// then three projects saved again so they read as "changed since the backup".
async function fillLibrary(port: string, token: string): Promise<void> {
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method, headers: { "Content-Type": "application/json", "X-Auth-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
    return r.json();
  };
  const music = path.join(FAKE_HOME, "Music");
  const sources = [path.join(music, "Ableton", "Projects"), path.join(music, "REAPER Projects"),
    path.join(music, "FL Studio", "Projects")];
  const cfg = await call("GET", "/api/settings");
  await call("PUT", "/api/settings", { ...cfg, sources, dest: path.join(WORK_DIR, "BackupDrive", "LazyCreatives Backups"),
    interval_minutes: 1440, libraries: [path.join(music, "Splice")] });
  const { projects } = await call("POST", "/api/scan", { sources, find_missing: false });
  await call("POST", "/api/exports/refresh", {}).catch(() => {});
  const paths: string[] = projects.map((p: { als_path?: string; path?: string }) => p.als_path || p.path).sort();
  const later = ["Neon Rain", "Night Market", "Cold Brew Sunday", "Untitled Beat 17"];
  const first = paths.filter((p) => !later.some((k) => p.includes(k)));
  const { job_id } = await call("POST", "/api/backup", { als_paths: first, portable: true, layout: "project_date", find_missing: true });
  await expect.poll(async () => (await call("GET", `/api/jobs/${job_id}`)).state, { timeout: 180_000, intervals: [500] })
    .not.toMatch(/^(running|cancelling|queued)$/);
  const now = new Date();
  for (const p of paths) if (["Midnight Drive", "Afterglow", "Acid Test 303"].some((k) => p.includes(k))) utimesSync(p, now, now);
  await call("POST", "/api/scan", { sources, find_missing: false });
  // the Mac-style plug-ins (Audio Units) sit in a folder of their own
  await call("PUT", "/api/plugins/folders", { folders: [path.join(FAKE_HOME, "Mac Plugins", "Components")] });
}

test("first run: welcome", async () => {
  for (const look of LOOKS) {
    const page = await open(look, "home");
    await expect(page.locator(".nav")).toHaveCount(0); // not set up yet: no side bar
    await snap(page, `welcome-${look}`);
  }
});

test("main screens", async () => {
  const { port, token } = running!;
  await fillLibrary(port, token);
  for (const look of LOOKS) {
    for (const screen of SCREENS) {
      await test.step(`${screen} (${look})`, async () => {
        const page = await open(look, screen);
        await expect(page.locator(".nav")).toBeVisible();
        await snap(page, `${screen}-${look}`);
      });
    }
  }
});
