import { describe, expect, it } from "vitest";
import { ago } from "../src/companion";
import { currentLine, currentProject, glance, projectState, recentProjects, stampMs } from "../src/companionPick";
import type { LibraryItem, Overview } from "../src/types";
// companion.js is the main-process side (CommonJS); only its pure placement is used here.
// @ts-ignore - untyped JS module imported for its runtime behaviour
import * as companionMain from "../electron/companion";

const { companionBounds } = companionMain as any;

const item = (name: string, mtime: number, more: Partial<LibraryItem> = {}): LibraryItem => ({
  project_id: name.toLowerCase(), name, path: `/m/${name}.als`, dir: "/m", owner: "x", size: 1, mtime,
  missing_count: 0, found_at: "t", last_backup: null, snapshot_count: 0, backed_up: false, ...more,
});
const ov = (more: Partial<Overview> = {}): Overview => ({
  projects_protected: 0, snapshot_count: 0, logical_size: 0, actual_size: 0, saved_bytes: 0, pool_known: true,
  last_run: "2026-10-05_1500", last_run_ok: true, attention: [],
  nas: { reachable: true, path: "/Volumes/Backup", free_bytes: 1, total_bytes: 2 },
  schedule: { enabled: false, interval_minutes: 0 }, ...more,
});
const idle = { active: false, completed: 0, total: 0 };

describe("the project you're working on now", () => {
  const items = [item("Old", 100), item("Newest", 900), item("Middle", 500), item("Older", 50)];
  it("is the one saved most recently", () => {
    expect(currentProject(items)?.name).toBe("Newest");
    expect(currentProject([])).toBe(null);
  });
  it("the recent list leaves it out and goes newest first", () => {
    const cur = currentProject(items);
    expect(recentProjects(items, cur, 2).map((i) => i.name)).toEqual(["Middle", "Old"]);
    expect(recentProjects(items, null).map((i) => i.name)).toEqual(["Newest", "Middle", "Old", "Older"]);
  });
});

describe("a project's state in a word", () => {
  it("missing samples beat changed, changed beats safe", () => {
    expect(projectState(item("A", 1, { missing_count: 3, changed: true, backed_up: true })).word).toBe("3 missing");
    expect(projectState(item("A", 1, { missing_count: 4000 })).word).toBe("999+ missing");
    expect(projectState(item("A", 1, { changed: true, backed_up: true })).tone).toBe("changed");
    expect(projectState(item("A", 1, { backed_up: true })).word).toBe("Safe");
    expect(projectState(item("A", 1)).word).toBe("Not backed up");
  });
  it("the line under the current project says it plainly", () => {
    expect(currentLine(item("A", 1, { missing_count: 1 }))).toBe("1 sample is missing");
    expect(currentLine(item("A", 1, { changed: true, backed_up: true }))).toBe("Saved since its last backup");
    expect(currentLine(item("A", 1))).toBe("Not backed up yet");
  });
});

describe("at a glance", () => {
  it("all safe when every project is backed up", () => {
    const g = glance(ov(), [item("A", 1, { backed_up: true })], idle);
    expect(g).toMatchObject({ tone: "ok", title: "All safe", detail: "1 of 1 projects safe" });
  });
  it("counts missing samples and failed backups as needing a look", () => {
    const g = glance(ov({ attention: [{ project_name: "B", kind: "error", reason: "x" }] }),
      [item("A", 1, { missing_count: 2 }), item("B", 1)], idle);
    expect(g).toMatchObject({ tone: "look", title: "2 need a look" });
  });
  it("changed or new projects are waiting for a backup", () => {
    const g = glance(ov(), [item("A", 1, { changed: true, backed_up: true }), item("B", 1)], idle);
    expect(g).toMatchObject({ tone: "changed", title: "2 waiting for a backup" });
  });
  it("says so when backups are off, the drive is away, or a backup is running", () => {
    expect(glance(ov({ nas: { reachable: false, path: "", free_bytes: 0, total_bytes: 0 } }), [], idle).tone).toBe("off");
    expect(glance(ov({ nas: { reachable: false, path: "/V", free_bytes: 0, total_bytes: 0 } }), [], idle).title).toBe("Backup drive not found");
    expect(glance(ov(), [], { active: true, completed: 2, total: 5 })).toMatchObject({ tone: "busy", detail: "2 of 5 done" });
  });
});

describe("times", () => {
  const now = new Date(2026, 9, 6, 15, 0).getTime();
  it("reads the engine's backup stamp", () => {
    expect(stampMs("2026-10-05_1503")).toBe(new Date(2026, 9, 5, 15, 3).getTime());
    expect(stampMs(null)).toBe(null);
    expect(stampMs("soon")).toBe(null);
  });
  it("says how long ago, short enough for a narrow column", () => {
    expect(ago(now - 20_000, now)).toBe("Just now");
    expect(ago(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(ago(now - 3 * 3600_000, now)).toBe("3 h ago");
    expect(ago(new Date(2026, 9, 5, 9, 0).getTime(), now)).toBe("Yesterday");
    expect(ago(new Date(2026, 9, 3, 9, 0).getTime(), now)).toBe("3 days ago");
    expect(ago(null, now)).toBe("Never");
    expect(ago(new Date(2026, 9, 6, 1, 0).getTime(), new Date(2026, 9, 6, 2, 30).getTime())).toBe("1 h ago");
    expect(ago(new Date(2026, 9, 5, 23, 0).getTime(), new Date(2026, 9, 6, 1, 0).getTime())).toBe("2 h ago");
  });
});

describe("where the narrow window opens", () => {
  const screens = [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }, { workArea: { x: 1440, y: 0, width: 1920, height: 1080 } }];
  it("against the right edge of the main window's screen the first time", () => {
    expect(companionBounds({}, screens, { x: 100, y: 100, width: 1100, height: 760 }))
      .toEqual({ x: 1440 - 340 - 16, y: 140, width: 340, height: 620 });
    expect(companionBounds({}, screens, { x: 1600, y: 50, width: 1100, height: 760 }).x).toBe(1440 + 1920 - 340 - 16);
  });
  it("where it was left, if that is still on a screen", () => {
    expect(companionBounds({ x: 20, y: 30, width: 380, height: 700 }, screens, null)).toEqual({ x: 20, y: 30, width: 380, height: 700 });
    expect(companionBounds({ x: 9000, y: 30, width: 380, height: 700 }, screens, null).x).toBe(1440 - 380 - 16);
  });
  it("keeps to the narrow sizes", () => {
    expect(companionBounds({ width: 900, height: 100 }, screens, null)).toMatchObject({ width: 420, height: 420 });
    expect(companionBounds({ width: 120 }, screens, null).width).toBe(300);
  });
});
