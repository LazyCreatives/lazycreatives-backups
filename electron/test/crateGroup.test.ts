import { describe, it, expect } from "vitest";
import { groupCrates } from "../src/screens/Crate/hooks/useCrates";
import { sortDigList } from "../src/screens/Crate/hooks/useDigList";
import { parseStamp, toProject, GENRE_COLOR, type Project } from "../src/screens/Crate/types";

const NOW = new Date(2026, 5, 9, 20, 0, 0).getTime(); // 2026-06-09 20:00

function p(over: Partial<Project>): Project {
  return {
    id: over.name ?? "x", name: "x", daw: "ableton", genre: "Unknown", bpm: null,
    musicalKey: null, sizeBytes: 0, modifiedAt: "2026-06-09_1000", verified: false,
    snapshots: 0, missing: 0, ...over,
  };
}

const FIX: Project[] = [
  p({ name: "Sunrise House", genre: "House", daw: "ableton", bpm: 124, sizeBytes: 30, modifiedAt: "2026-06-09_1000", verified: true }),
  p({ name: "Deep Cut", genre: "House", daw: "flstudio", bpm: 128, sizeBytes: 50, modifiedAt: "2026-06-01_1200" }),
  p({ name: "Warehouse", genre: "Techno", daw: "ableton", bpm: 140, sizeBytes: 10, modifiedAt: "2026-04-01_1200", verified: true }),
  p({ name: "Boom Bap", genre: "Hip-Hop", daw: "reaper", bpm: 90, sizeBytes: 20, modifiedAt: "2026-06-08_1200" }),
  p({ name: "Drift", genre: "Unknown", daw: "ableton", bpm: null, sizeBytes: 5, modifiedAt: "2026-06-09_0900" }),
];

describe("parseStamp", () => {
  it("parses the catalog 'YYYY-MM-DD_HHMM' format", () => {
    expect(parseStamp("2026-06-09_2015")).toBe(new Date(2026, 5, 9, 20, 15).getTime());
  });
  it("returns 0 for unparseable input", () => {
    expect(parseStamp("nonsense")).toBe(0);
    expect(parseStamp("")).toBe(0);
  });
});

describe("groupCrates", () => {
  it("groups by genre, biggest crate first, with genre accent", () => {
    const g = groupCrates(FIX, "genre", "count", "", NOW);
    expect(g[0].label).toBe("House");
    expect(g[0].count).toBe(2);
    expect(g[0].accent).toBe(GENRE_COLOR.House);
    expect(new Set(g.map((c) => c.label))).toEqual(new Set(["House", "Techno", "Hip-Hop", "Unknown"]));
  });
  it("groups by daw with display labels", () => {
    const g = groupCrates(FIX, "daw", "count", "", NOW);
    const byLabel = Object.fromEntries(g.map((c) => [c.label, c.count]));
    expect(byLabel).toEqual({ Ableton: 3, "FL Studio": 1, Reaper: 1 });
  });
  it("buckets by tempo (incl. Unknown for null bpm)", () => {
    const g = groupCrates(FIX, "tempo", "count", "", NOW);
    const byLabel = Object.fromEntries(g.map((c) => [c.label, c.count]));
    expect(byLabel["121–140 BPM"]).toBe(3);
    expect(byLabel["≤90 BPM"]).toBe(1);
    expect(byLabel["Unknown BPM"]).toBe(1);
  });
  it("buckets by recency relative to `now`", () => {
    const g = groupCrates(FIX, "recency", "count", "", NOW);
    const labels = g.map((c) => c.label);
    expect(labels).toContain("This week");  // Sunrise House, Boom Bap, Drift
    expect(labels).toContain("This month"); // Deep Cut (2026-06-01)
    expect(labels).toContain("Older");      // Warehouse (2026-04-01)
  });
  it("sorts crates by name", () => {
    const g = groupCrates(FIX, "genre", "name", "", NOW);
    expect(g.map((c) => c.label)).toEqual(["Hip-Hop", "House", "Techno", "Unknown"]);
  });
  it("filters by search (case-insensitive substring)", () => {
    const g = groupCrates(FIX, "genre", "count", "sun", NOW);
    expect(g).toHaveLength(1);
    expect(g[0].projects[0].name).toBe("Sunrise House");
  });
});

describe("sortDigList", () => {
  it("sorts by bpm desc, nulls last", () => {
    expect(sortDigList(FIX, "bpm", false).map((p) => p.bpm)).toEqual([140, 128, 124, 90, null]);
  });
  it("sorts by size desc", () => {
    expect(sortDigList(FIX, "size", false).map((p) => p.sizeBytes)).toEqual([50, 30, 20, 10, 5]);
  });
  it("sorts by recent (parsed timestamp) desc", () => {
    expect(sortDigList(FIX, "recent", false).map((p) => p.name))
      .toEqual(["Sunrise House", "Drift", "Boom Bap", "Deep Cut", "Warehouse"]);
  });
  it("verifiedOnly keeps only verified", () => {
    expect(sortDigList(FIX, "name", true).map((p) => p.name)).toEqual(["Sunrise House", "Warehouse"]);
  });
});

describe("toProject", () => {
  it("maps a ProjectRow, falling back genre→Unknown, bpm→null, key→null", () => {
    const pr = toProject({ project_name: "Track", snapshot_count: 2, last_timestamp: "2026-06-09_1000", total_size: 99, daw: "flstudio" } as any);
    expect(pr).toMatchObject({ id: "Track", name: "Track", daw: "flstudio", genre: "Unknown", bpm: null, musicalKey: null, sizeBytes: 99, verified: true, snapshots: 2 });
  });
  it("coerces unknown daw strings to 'unknown'", () => {
    expect(toProject({ project_name: "X", snapshot_count: 0, last_timestamp: "", total_size: 0, daw: "bitwig" } as any).daw).toBe("unknown");
  });
});
