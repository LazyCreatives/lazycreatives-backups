import { describe, it, expect } from "vitest";
import { countStatuses, statusSummary } from "../src/libraryFilter";
import { judge, plainReason } from "../src/runBackup";
import { fmtDay } from "../src/format";
import { toProjectFromLibrary } from "../src/screens/Crate/types";
import type { LibraryItem } from "../src/types";

const it0 = (over: Partial<LibraryItem>): LibraryItem => ({
  project_id: over.name ?? "x", name: "x", path: "/p", dir: "/", daw: "ableton", owner: "me", size: 0, mtime: 0,
  missing_count: 0, genre: null, bpm: null, found_at: "", last_backup: null, snapshot_count: 0, backed_up: false,
  latest_export: null, ...over,
});

describe("one way of counting", () => {
  const items = [
    it0({ name: "a", backed_up: true }), it0({ name: "b", backed_up: true }),
    it0({ name: "c", backed_up: true, changed: true }),
    it0({ name: "d", backed_up: true, missing_count: 2 }),  // backed up but missing: not safe
    it0({ name: "e" }),
  ];
  it("a project missing samples is not also counted as safe", () => {
    expect(countStatuses(items)).toEqual({ all: 5, safe: 2, changed: 1, missing: 1, none: 1 });
  });
  it("reads as one line for the Library heading", () => {
    expect(statusSummary(countStatuses(items))).toBe("2 safe · 1 changed · 1 missing samples · 1 not backed up yet");
  });
  it("Dig records carry the same state", () => {
    expect(items.map(toProjectFromLibrary).map((p) => p.status)).toEqual(["safe", "safe", "changed", "missing", "none"]);
  });
});

describe("a backup that didn't work says why", () => {
  it("a finished run with a failed project is not a success", () => {
    const r = judge({ ok_count: 0, error_count: 1, errors: [{ project_name: "x", error: "[Errno 28] No space left on device" }] }, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe("The backup drive is full."); expect(r.failed[0].project_name).toBe("x"); }
  });
  it("a project file that wasn't there is not a success either", () => {
    const r = judge({ ok_count: 0, error_count: 0, skipped_count: 0 }, 1);
    expect(r.ok).toBe(false);
  });
  it("nothing changed is fine", () => {
    expect(judge({ ok_count: 0, error_count: 0, skipped_count: 1 }, 1).ok).toBe(true);
  });
  it("unknown errors keep their text, short", () => {
    expect(plainReason("weird thing")).toBe("Something went wrong: weird thing");
    expect(plainReason("")).toMatch(/went wrong/);
  });
});

describe("dates follow the computer", () => {
  it("formats with the computer's own locale, and says — for nothing", () => {
    const d = new Date(2026, 9, 7, 14, 5);
    expect(fmtDay(d)).toBe(d.toLocaleString([], { day: "numeric", month: "short", year: "numeric" }));
    expect(fmtDay(d.getTime(), { time: true })).toContain(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    expect(fmtDay(null)).toBe("—");
    expect(fmtDay(0)).toBe("—");
  });
});
