import { describe, expect, it } from "vitest";
import { fuzzyScore } from "./fuzzy";

// SHARED FILE: the same file lives in Backups and Uploader (electron/src/fuzzy.test.ts).
describe("fuzzyScore", () => {
  it("finds names with typos, accents and half-typed words", () => {
    expect(fuzzyScore("midnite", ["Midnight Drive"])).toBeGreaterThan(0);
    expect(fuzzyScore("cafe", ["Café del Mar"])).toBeGreaterThan(0);
    expect(fuzzyScore("deepcut", ["Deep Cut"])).toBeGreaterThan(0);
    expect(fuzzyScore("zebra", ["Midnight Drive"])).toBe(0);
  });

  it("finds names written in other scripts", () => {
    expect(fuzzyScore("東京", ["東京 ナイト"])).toBeGreaterThan(0);
    expect(fuzzyScore("ночь", ["Ночь в городе"])).toBeGreaterThan(0);
    expect(fuzzyScore("서울", ["서울 밤"])).toBeGreaterThan(0);
    expect(fuzzyScore("ガレージ", ["ガレージ 2"])).toBeGreaterThan(0);
    expect(fuzzyScore("東京", ["大阪"])).toBe(0);
  });
});
