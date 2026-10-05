import { describe, expect, it } from "vitest";
import { fmtNext } from "../src/format";

describe("fmtNext", () => {
  const now = new Date(2026, 9, 5, 15, 4);
  it("says today or tomorrow so a time alone never reads as the wrong day", () => {
    expect(fmtNext(new Date(2026, 9, 5, 18, 0).toISOString(), now)).toMatch(/^today /);
    expect(fmtNext(new Date(2026, 9, 6, 15, 5).toISOString(), now)).toMatch(/^tomorrow /);
  });
  it("shows the date further out, and a dash when unknown", () => {
    expect(fmtNext(new Date(2026, 9, 9, 9, 0).toISOString(), now)).not.toMatch(/today|tomorrow/);
    expect(fmtNext(null, now)).toBe("—");
  });
});
