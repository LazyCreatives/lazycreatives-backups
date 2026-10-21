import { describe, expect, it } from "vitest";
import { SHOW, shownFolders } from "./ProjectFolders";

const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}` }));

describe("shownFolders", () => {
  it("shows every folder when there are only a few", () => {
    expect(shownFolders(many(SHOW), null)).toHaveLength(SHOW);
  });
  it("shows the first few of hundreds", () => {
    expect(shownFolders(many(500), null).map((f) => f.id)).toEqual(many(SHOW).map((f) => f.id));
  });
  it("keeps the open folder in the row when it's further down", () => {
    const row = shownFolders(many(500), "f321");
    expect(row).toHaveLength(SHOW + 1);
    expect(row[SHOW].id).toBe("f321");
  });
  it("doesn't add the open folder twice", () => {
    expect(shownFolders(many(500), "f2")).toHaveLength(SHOW);
  });
});
