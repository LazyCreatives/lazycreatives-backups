// Picture tests for LazyCreatives Backups: start the real app, then take a picture
// of each main screen in both looks and compare it with the saved one.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, utimesSync } from "node:fs";
import path from "node:path";
import { FAKE_HOME, WINDOW, WORK_DIR, closeApp, launchApp, resizeWindow, type RunningApp } from "./app";

const LOOKS = ["crate", "sleeve"] as const;
type Look = (typeof LOOKS)[number];
const SCREENS = ["home", "library", "dig", "plugins", "settings"] as const;
type Theme = "dark" | "light";
// The smallest the window can be made (MIN_SIZE in electron/desktop.js): the
// narrow-window layout (max-width 1099px) at its tightest.
const NARROW = { width: 760, height: WINDOW.height };
// The project opened as its own page (backed up, then saved again, with exported songs).
const PROJECT = "Midnight Drive";

let running: RunningApp | undefined;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { running = await launchApp(); });
test.afterAll(async () => { await closeApp(running); });

// Open the app on `tab` in `look` and `theme`: all three are read from localStorage
// when the page loads (lc-look, lc-theme: see src/look.ts; lc-last-page: the page the
// app reopens on).
async function open(look: Look, tab: string, theme: Theme = "dark"): Promise<Page> {
  const { page, version } = running!;
  await page.evaluate(([l, t, v, th]) => {
    localStorage.setItem("lc-look", l);
    localStorage.setItem("lc-theme", th);
    localStorage.setItem("lc-last-page", JSON.stringify(t));
    localStorage.setItem("lc_onboarded", "1");     // the one-time "first backup done" note
    localStorage.setItem("lc-seen-version", v);    // "What's new" already read
  }, [look, tab, version, theme] as const);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-look", look);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
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

async function snap(page: Page, name: string, extraMask: Locator[] = []): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: [...changing(page), ...extraMask], fullPage: false });
}

// A project's page also shows the day it was first seen ("First on record", "started
// Oct 8, 2026", the label's "est. 2026"): the made-up projects are made on the day of
// the run. Its exported songs' times run wider than their column, so clip them to it
// (and so under the box that covers them).
const DAY = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}\b|^est\. \d{4}$/;
async function snapProject(page: Page, name: string): Promise<void> {
  await page.addStyleTag({ content: ".sub.col-num { overflow: hidden; }" }); // gone at the next reload
  await snap(page, name, [page.getByText(DAY)]);
}

// The backend's API, signed in as the app is.
function apiOf(port: string, token: string) {
  const base = `http://127.0.0.1:${port}`;
  return async (method: string, url: string, body?: unknown) => {
    const r = await fetch(base + url, {
      method, headers: { "Content-Type": "application/json", "X-Auth-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
    return r.json();
  };
}

// Open PROJECT's own page from the Library, the way a click on its row does.
async function openProject(look: Look, theme: Theme = "dark"): Promise<Page> {
  const { port, token } = running!;
  const { projects } = await apiOf(port, token)("GET", "/api/library");
  const it = (projects as { project_id: string; name: string }[]).find((p) => p.name === PROJECT);
  if (!it) throw new Error(`${PROJECT} is not in the library`);
  const page = await open(look, "library", theme);
  await page.locator(`[data-nav-key="${it.project_id}"]`).first().dispatchEvent("click");
  await expect(page.locator(".lib-back")).toBeVisible();
  await settle(page);
  return page;
}

// Fill the backend through its own API the way a user would through the app:
// project folders and a backup drive, a scan, the exported songs, one backup,
// then three projects saved again so they read as "changed since the backup".
async function fillLibrary(port: string, token: string): Promise<void> {
  const call = apiOf(port, token);
  const music = path.join(FAKE_HOME, "Music");
  const sources = [path.join(music, "Ableton", "Projects"), path.join(music, "REAPER Projects"),
    path.join(music, "FL Studio", "Projects")];
  // the backup drive is plugged in (Backups won't make a folder on a drive that isn't there)
  const dest = path.join(WORK_DIR, "BackupDrive", "LazyCreatives Backups");
  mkdirSync(dest, { recursive: true });
  const cfg = await call("GET", "/api/settings");
  await call("PUT", "/api/settings", { ...cfg, sources, dest,
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

test("project page", async () => {
  for (const look of LOOKS) {
    await test.step(`project (${look})`, async () => {
      const page = await openProject(look);
      await snapProject(page, `project-${look}`);
    });
  }
});

test("light mode", async () => {
  for (const look of LOOKS) {
    for (const screen of SCREENS) {
      await test.step(`${screen} light (${look})`, async () => {
        const page = await open(look, screen, "light");
        await expect(page.locator(".nav")).toBeVisible();
        await snap(page, `${screen}-${look}-light`);
      });
    }
    await test.step(`project light (${look})`, async () => {
      const page = await openProject(look, "light");
      await snapProject(page, `project-${look}-light`);
    });
  }
});

test("narrow window", async () => {
  await resizeWindow(running!, NARROW);
  try {
    for (const look of LOOKS) {
      await test.step(`library narrow (${look})`, async () => {
        const page = await open(look, "library");
        await expect(page.locator(".nav")).toBeVisible();
        await snap(page, `library-${look}-narrow`);
      });
      await test.step(`project narrow (${look})`, async () => {
        const page = await openProject(look);
        await snapProject(page, `project-${look}-narrow`);
      });
    }
  } finally {
    await resizeWindow(running!, WINDOW);
  }
});

// Last, because it stops the page's clock: an album's "44 days to go" and release
// date read from today's date. The clock is fixed only for the page (dates are
// worked out there), so the backend's own times are left alone.
test("albums", async () => {
  const { page, port, token } = running!;
  const call = apiOf(port, token);
  await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
  const songs = (await call("GET", "/api/albums/candidates")) as { path: string; title: string; project: string; genre?: string }[];
  expect(songs.length).toBeGreaterThan(5);
  const pick = [...songs].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 6);
  const album = await call("POST", "/api/albums", { title: "Late Night Tapes", release_date: "2026-11-14" });
  await call("POST", `/api/albums/${album.id}/songs`, { songs: pick.map(({ path, title, project, genre }) => ({ path, title, project, genre })) });
  await call("PUT", `/api/albums/${album.id}`, { crossfade: 3 });
  await call("PUT", `/api/albums/${album.id}/song`, { path: pick[0].path, ready: true });
  await call("PUT", `/api/albums/${album.id}/song`, { path: pick[1].path, ready: true, gapless_after: true });
  await call("POST", "/api/albums", { title: "Sketchbook Vol. 2", release_date: "" });
  for (const look of LOOKS) {
    await test.step(`albums (${look})`, async () => {
      const p = await open(look, "albums");
      await expect(p.getByText("Late Night Tapes").first()).toBeVisible();
      await snap(p, `albums-${look}`);
    });
    await test.step(`album (${look})`, async () => {
      await page.locator(".alb-row, .alb-sleeve").filter({ hasText: "Late Night Tapes" }).click();
      await expect(page.locator(".albpage__head")).toBeVisible();
      await settle(page);
      await snap(page, `album-${look}`);
    });
  }
});
