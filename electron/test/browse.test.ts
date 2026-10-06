import { describe, it, expect } from "vitest";
import { facets, NO_GENRE } from "../src/components/Browse";
import { paletteResults, type PaletteItem } from "../src/components/Palette";
import { sameFilters } from "../src/smart";
import { NO_FILTERS, applyFilters, describeFilters } from "../src/libraryFilter";

const items = [
  { genre: "House", year: "2025" }, { genre: "House", year: "2024" }, { genre: "Techno", year: "2025" }, { genre: null, year: "2023" },
];

describe("Genre > Year browsing", () => {
  it("counts genres most first, with no-genre last, and years newest first", () => {
    const f = facets(items, (i) => i.genre, (i) => i.year, "");
    expect(f.genres.map((g) => [g.value, g.n])).toEqual([["House", 2], ["Techno", 1], [NO_GENRE, 1]]);
    expect(f.years.map((y) => y.value)).toEqual(["2025", "2024", "2023"]);
  });
  it("counts only the picked genre's years", () => {
    expect(facets(items, (i) => i.genre, (i) => i.year, "House").years.map((y) => [y.value, y.n])).toEqual([["2025", 1], ["2024", 1]]);
    expect(facets(items, (i) => i.genre, (i) => i.year, NO_GENRE).years.map((y) => y.value)).toEqual(["2023"]);
  });
});

describe("smart crates", () => {
  it("treats the same filters as the same crate, whatever the case of the search", () => {
    expect(sameFilters({ ...NO_FILTERS, q: " Dub " }, { ...NO_FILTERS, q: "dub" })).toBe(true);
    expect(sameFilters({ ...NO_FILTERS, genre: "House" }, NO_FILTERS)).toBe(false);
  });
  it("suggests a name from the filters", () => {
    expect(describeFilters({ ...NO_FILTERS, genre: "House", bpm: "120", status: "none" })).toBe("House · 120–129 BPM · Not backed up");
    expect(describeFilters(NO_FILTERS)).toBe("Everything");
  });
  it("filters by year last saved and no genre", () => {
    const at = (y: number) => new Date(y, 5, 1).getTime() / 1000;
    const lib = [
      { project_id: "a", name: "A", genre: "House", mtime: at(2024) }, { project_id: "b", name: "B", genre: null, mtime: at(2025) },
    ] as any[];
    expect(applyFilters(lib, { ...NO_FILTERS, year: "2024" }).map((i) => i.name)).toEqual(["A"]);
    expect(applyFilters(lib, { ...NO_FILTERS, genre: NO_GENRE }).map((i) => i.name)).toEqual(["B"]);
  });
});

describe("find anything (Cmd/Ctrl+K)", () => {
  const run = () => {};
  const list: PaletteItem[] = [
    { id: "1", group: "Go to", label: "Library", run },
    { id: "2", group: "Projects", label: "Midnight Drive", quiet: true, run },
    { id: "3", group: "Projects", label: "Night Market", quiet: true, words: ["House"], run },
  ];
  it("hides the long lists until something is typed", () => {
    expect(paletteResults(list, "").map((i) => i.id)).toEqual(["1"]);
  });
  it("finds by name or by its other words, best first", () => {
    expect(paletteResults(list, "night").map((i) => i.id)).toEqual(["3", "2"]);
    expect(paletteResults(list, "house").map((i) => i.id)).toEqual(["3"]);
  });
});
