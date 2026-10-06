import { describe, expect, it } from "vitest";
import { fmtCap, fmtCount } from "../src/format";

// Counts that reach the thousands read with digit grouping, and tight spots cap at 999+.
describe("fmtCount / fmtCap", () => {
  const g = (n: number) => n.toLocaleString();
  it("groups digits the computer's way", () => {
    expect(fmtCount(2441)).toBe(g(2441));
    expect(fmtCount(7)).toBe("7");
    expect(fmtCount(0)).toBe("0");
  });
  it("shows a dash for a missing count", () => {
    expect(fmtCount(null)).toBe("—");
    expect(fmtCount(undefined)).toBe("—");
    expect(fmtCount(NaN)).toBe("—");
  });
  it("caps past the limit", () => {
    expect(fmtCap(12345)).toBe("999+");
    expect(fmtCap(999)).toBe("999");
    expect(fmtCap(3)).toBe("3");
  });
});
