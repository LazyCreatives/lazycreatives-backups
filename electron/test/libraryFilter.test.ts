import { describe, it, expect } from "vitest";
import { fuzzyScore } from "../src/fuzzy";
import { applyFilters, NO_FILTERS, isFiltered } from "../src/libraryFilter";
import type { LibraryItem } from "../src/types";

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    project_id: over.name ?? "x", name: "x", path: "/p", dir: "/", daw: "ableton", owner: "me", size: 0, mtime: 0,
    missing_count: 0, genre: null, bpm: null, found_at: "", last_backup: null, snapshot_count: 0, backed_up: false,
    latest_export: null, ...over,
  };
}

const ITEMS = [
  item({ name: "Midnight Warehouse", genre: "Techno", bpm: 132, backed_up: true }),
  item({ name: "Deep Cut", genre: "House", daw: "flstudio", bpm: 124, missing_count: 2 }),
  item({ name: "DNB NOT GOOD", genre: "Drum & Bass", bpm: 174, latest_export: { path: "/a.mp3", name: "dnb final", mtime: 0, uploaded: true } }),
  item({ name: "Sunrise", genre: "House", bpm: 122, latest_export: { path: "/b.mp3", name: "sunrise v2", mtime: 0, uploaded: false } }),
];
const names = (r: LibraryItem[]) => r.map((i) => i.name);

describe("fuzzy search", () => {
  it("finds typos, half words and squashed words", () => {
    expect(fuzzyScore("warehose", ["Midnight Warehouse"])).toBeGreaterThan(0);
    expect(fuzzyScore("midn", ["Midnight Warehouse"])).toBeGreaterThan(0);
    expect(fuzzyScore("deepcut", ["Deep Cut"])).toBeGreaterThan(0);
    expect(fuzzyScore("sunrsie", ["Sunrise"])).toBeGreaterThan(0);
  });
  it("needs every typed word to match and does not over-match", () => {
    expect(fuzzyScore("deep techno", ["Deep Cut"])).toBe(0);
    expect(fuzzyScore("zzz", ["Deep Cut"])).toBe(0);
    expect(fuzzyScore("cat", ["Deep Cut"])).toBe(0);
  });
  it("puts exact name hits first", () => {
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, q: "house" }))[0]).toBe("Midnight Warehouse");
  });
  it("searches genre and song names too", () => {
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, q: "techno" }))).toEqual(["Midnight Warehouse"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, q: "v2" }))).toEqual(["Sunrise"]);
  });
});

describe("filters", () => {
  it("filters by status, DAW, genre, BPM and songs", () => {
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, status: "missing" }))).toEqual(["Deep Cut"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, status: "safe" }))).toEqual(["Midnight Warehouse"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, status: "none" }))).toEqual(["DNB NOT GOOD", "Sunrise"]);
    const edited = [...ITEMS, item({ name: "Night Edit", backed_up: true, changed: true })];
    expect(names(applyFilters(edited, { ...NO_FILTERS, status: "changed" }))).toEqual(["Night Edit"]);
    expect(names(applyFilters(edited, { ...NO_FILTERS, status: "safe" }))).toEqual(["Midnight Warehouse"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, daw: "flstudio" }))).toEqual(["Deep Cut"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, genre: "House" }))).toEqual(["Deep Cut", "Sunrise"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, bpm: "120" }))).toEqual(["Deep Cut", "Sunrise"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, bpm: "170" }))).toEqual(["DNB NOT GOOD"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, song: "soundcloud" }))).toEqual(["DNB NOT GOOD"]);
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, song: "nosong" }))).toEqual(["Midnight Warehouse", "Deep Cut"]);
  });
  it("combines filters and knows when nothing is picked", () => {
    expect(names(applyFilters(ITEMS, { ...NO_FILTERS, genre: "House", song: "has" }))).toEqual(["Sunrise"]);
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, q: "  " })).toBe(false);
  });
});

import { sortItems } from "../src/libraryFilter";
describe("sorting", () => {
  it("sorts by each column, flips, and keeps empty values last", () => {
    expect(names(sortItems(ITEMS, { key: "name", dir: 1 }))).toEqual(["Deep Cut", "DNB NOT GOOD", "Midnight Warehouse", "Sunrise"]);
    expect(names(sortItems(ITEMS, { key: "bpm", dir: -1 }))).toEqual(["DNB NOT GOOD", "Midnight Warehouse", "Deep Cut", "Sunrise"]);
    expect(names(sortItems(ITEMS, { key: "status", dir: 1 }))[0]).toBe("Deep Cut");
    expect(names(sortItems(ITEMS, { key: "song", dir: 1 }))).toEqual(["DNB NOT GOOD", "Sunrise", "Midnight Warehouse", "Deep Cut"]);
    expect(names(sortItems(ITEMS, { key: "song", dir: -1 })).slice(2)).toEqual(["Midnight Warehouse", "Deep Cut"]);
  });
});
