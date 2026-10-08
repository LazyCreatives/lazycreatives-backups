import { describe, expect, it } from "vitest";
import { applyFilters, NO_FILTERS } from "./libraryFilter";
import type { LibraryItem } from "./types";

const item = (name: string, genre = ""): LibraryItem => ({ project_id: name, name, path: `/m/${name}.als`, dir: "/m", owner: "me",
  size: 1, mtime: 1, missing_count: 0, genre, found_at: "", last_backup: null, snapshot_count: 0, backed_up: false });

describe("Library search on a big list", () => {
  const items = [item("Midnight Drive", "House"), item("Mild Sauce", "Trap"), item("Rain", "Midtempo"), item("Other")];
  it("each search text gets its own answer (the matching is kept per text)", () => {
    const names = (q: string) => applyFilters(items, { ...NO_FILTERS, q }).map((i) => i.name);
    expect(names("mid")).toEqual(["Midnight Drive", "Rain"]);   // the name beats a genre hit
    expect(names("mild")).toEqual(["Mild Sauce"]);
    expect(names("mid")).toEqual(["Midnight Drive", "Rain"]);
    expect(names("")).toHaveLength(4);
  });
  it("a new list is matched afresh", () => {
    const more = [...items, item("Midway")];
    expect(applyFilters(more, { ...NO_FILTERS, q: "mid" }).map((i) => i.name)).toContain("Midway");
  });
});
