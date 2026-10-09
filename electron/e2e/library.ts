// The made-up library the picture tests use, filled through the backend's own API.
// Shared by screens.spec.ts and colourblind.spec.ts.
import { expect } from "@playwright/test";
import { mkdirSync, utimesSync } from "node:fs";
import path from "node:path";
import { FAKE_HOME, WORK_DIR } from "./app";

// The backend's API, signed in as the app is.
export function apiOf(port: string, token: string) {
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

// Fill the backend through its own API the way a user would through the app:
// project folders and a backup drive, a scan, the exported songs, one backup,
// then three projects saved again so they read as "changed since the backup".
export async function fillLibrary(port: string, token: string): Promise<void> {
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
