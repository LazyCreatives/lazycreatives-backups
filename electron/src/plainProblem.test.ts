import { describe, expect, it } from "vitest";
import { LOST_ENGINE, plainProblem } from "./plainProblem";

describe("plainProblem", () => {
  it("swaps the engine's short notes for plain words", () => {
    expect(plainProblem("no such picture", 404)).toBe("That picture isn't there any more. Pick it again.");
    expect(plainProblem("picture is too big (12 MB at most)", 413)).toMatch(/over 12 MB/);
  });
  it("says the engine went away when it doesn't answer or rejects the app", () => {
    expect(plainProblem(null, 0)).toBe(LOST_ENGINE);
    expect(plainProblem("invalid or missing token", 401)).toBe(LOST_ENGINE);
  });
  it("keeps messages already written for people", () => {
    expect(plainProblem("That album isn't there any more", 404)).toBe("That album isn't there any more");
  });
  it("never shows a bare number, an unknown note or a validation list", () => {
    const cases: [unknown, number][] = [["500", 500], [null, 500], ["weird internal thing", 400], [[{ loc: ["body"] }], 422]];
    for (const [d, s] of cases) {
      const out = plainProblem(d, s);
      expect(out).toMatch(/^Something went wrong inside the app\./);
      expect(out).toMatch(/Report a problem/);
    }
  });
});
