import { describe, it, expect } from "vitest";
import { applyFilters, sortItems, viewFor, JUST_BACKED_UP, NO_FILTERS, type LibFilters } from "../src/libraryFilter";
import { NavHistory, type Place } from "../src/nav";
import type { LibraryItem } from "../src/types";

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    project_id: over.name ?? "x", name: "x", path: "/p", dir: "/", daw: "ableton", owner: "me", size: 0, mtime: 0,
    missing_count: 0, genre: null, bpm: null, found_at: "", last_backup: null, snapshot_count: 0, backed_up: false,
    latest_export: null, ...over,
  };
}

// Just after a first backup: three projects backed up a moment ago, one older.
const ITEMS = [
  item({ name: "Old Sketch", backed_up: true, last_backup: "2026-09-01T10:00:00" }),
  item({ name: "Night Drive", backed_up: true, last_backup: "2026-10-05T14:03:00" }),
  item({ name: "Never Saved", backed_up: false }),
  item({ name: "Sunday Dub", backed_up: true, last_backup: "2026-10-05T14:04:00", missing_count: 1 }),
];
// What was left on the Library from earlier: "Not backed up" ticked and a search typed.
const LEFT_OVER: LibFilters = { ...NO_FILTERS, status: "none", q: "never" };
const shownBy = (v: ReturnType<typeof viewFor>) => sortItems(applyFilters(ITEMS, v.filters), v.sort).map((i) => i.name);

describe("See your backed-up projects", () => {
  it("lands on every project with the ones just backed up on top, whatever filter was left on", () => {
    expect(applyFilters(ITEMS, LEFT_OVER).map((i) => i.name)).toEqual(["Never Saved"]);  // the old view hid them
    const v = viewFor(JUST_BACKED_UP, { key: "name", dir: 1 });
    expect(v.filters).toEqual(NO_FILTERS);
    expect(shownBy(v)).toEqual(["Sunday Dub", "Night Drive", "Old Sketch", "Never Saved"]);
  });

  it("still has to do something when the backup was started from the Library itself", () => {
    // Going to the Library while on it is no move at all, which is why the button
    // used to just close the box: the view has to travel separately.
    const h = new NavHistory<Place>({ tab: "library" });
    expect(h.go({ tab: "library", sub: null, flow: null }, 0)).toBe(false);
  });
});

describe("the counts on Home", () => {
  it("open the Library on just the projects they count, keeping the chosen sort", () => {
    const sort = { key: "name", dir: 1 } as const;
    const safe = viewFor({ status: "safe" }, sort);
    expect(safe.sort).toBe(sort);
    expect(shownBy(safe)).toEqual(["Night Drive", "Old Sketch"]);
    expect(shownBy(viewFor({ status: "missing" }, sort))).toEqual(["Sunday Dub"]);
    expect(shownBy(viewFor({ status: "none" }, sort))).toEqual(["Never Saved"]);
  });
});
