import { describe, expect, it } from "vitest";
import { READING_DEFAULT, parseReading } from "./reading";

describe("parseReading", () => {
  it("is off with the suggested fine-tunes when nothing is saved", () => {
    expect(parseReading(null)).toEqual(READING_DEFAULT);
    expect(parseReading("not json")).toEqual(READING_DEFAULT);
  });
  it("keeps a saved choice", () => {
    const r = { on: true, size: 1.25, font: "opendyslexic", space: "widest", tint: "cream", calm: false };
    expect(parseReading(JSON.stringify(r))).toEqual(r);
  });
  it("throws out values it doesn't know and keeps text size between 100% and 150%", () => {
    const r = parseReading(JSON.stringify({ on: "yes", size: 9, font: "comic", space: 3, tint: "pink" }));
    expect(r).toEqual({ ...READING_DEFAULT, on: false, size: 1.5 });
    expect(parseReading(JSON.stringify({ size: 0.5 })).size).toBe(1);
  });
});
