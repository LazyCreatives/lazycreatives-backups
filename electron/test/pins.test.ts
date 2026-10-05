import { describe, it, expect } from "vitest";
import { pinnedFirst } from "../src/pins";

describe("pinned projects", () => {
  it("puts pinned ones first in pin order and keeps the rest in place", () => {
    const items = ["a", "b", "c", "d"].map((project_id) => ({ project_id }));
    expect(pinnedFirst(items, ["d", "b"]).map((i) => i.project_id)).toEqual(["d", "b", "a", "c"]);
    expect(pinnedFirst(items, []).map((i) => i.project_id)).toEqual(["a", "b", "c", "d"]);
    expect(pinnedFirst(items, ["zz"]).map((i) => i.project_id)).toEqual(["a", "b", "c", "d"]);
  });
});
