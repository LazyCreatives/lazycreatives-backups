// Short strip names on the Stems desk: the words every stem shares are dropped.
import { describe, expect, it } from "vitest";
import { stemLabels, trimShared, withoutExt } from "./stemNames";

describe("trimShared", () => {
  it("drops the whole words every name shares at the start and the end", () => {
    expect(trimShared([
      "Song - Kick 001 (Final Bounce)",
      "Song - Snare 002 (Final Bounce)",
      "Song - Vox Chop 011 (Final Bounce)",
    ])).toEqual(["Kick 001", "Snare 002", "Vox Chop 011"]);
  });
  it("keeps whole words: a shared start that ends mid-word stays", () => {
    expect(trimShared(["Bassline", "Bass drum"])).toEqual(["Bassline", "Bass drum"]);
    expect(trimShared(["Kick_Final", "Snare_Final"])).toEqual(["Kick", "Snare"]);
  });
  it("leaves one name, and names that share nothing, as they are", () => {
    expect(trimShared(["Night Drive - Kick (Final)"])).toEqual(["Night Drive - Kick (Final)"]);
    expect(trimShared(["Kick", "Snare", "真夜中のドライブ"])).toEqual(["Kick", "Snare", "真夜中のドライブ"]);
    expect(trimShared([])).toEqual([]);
  });
  it("never empties a name: each keeps at least one word of its own", () => {
    expect(trimShared(["Kick", "Kick 2"])).toEqual(["Kick", "Kick 2"]);
    expect(trimShared(["Song Kick", "Song Kick 2"])).toEqual(["Kick", "Kick 2"]);
    expect(trimShared(["Same name", "Same name"])).toEqual(["Same name", "Same name"]);
  });
  it("tidies a bracket whose other half was shared", () => {
    expect(trimShared(["Mix (Kick)", "Mix (Snare)"])).toEqual(["Kick", "Snare"]);
  });
});

describe("stemLabels", () => {
  it("keeps the short parts when they already differ", () => {
    expect(stemLabels([
      { part: "Kick", name: "Song 3-Kick.wav" },
      { part: "Snare", name: "Song 4-Snare.wav" },
    ])).toEqual(["Kick", "Snare"]);
  });
  it("uses the file names when every part reads the same", () => {
    const tail = " (The Extraordinarily Long Stem Name Bounce)";
    expect(stemLabels([
      { part: "The Extraordinarily Long Stem Name Bounce", name: `Acid Test 303 - Kick 001${tail}.wav` },
      { part: "The Extraordinarily Long Stem Name Bounce", name: `Acid Test 303 - Snare 002${tail}.wav` },
      { part: "The Extraordinarily Long Stem Name Bounce", name: `Acid Test 303 - Hats 003${tail}.wav` },
    ])).toEqual(["Kick 001", "Snare 002", "Hats 003"]);
  });
  it("shows one stem by its own part", () => {
    expect(stemLabels([{ part: "Vocals", name: "Night Drive - Vocals.wav" }])).toEqual(["Vocals"]);
  });
  it("drops the file extension", () => {
    expect(withoutExt("Kick.wav")).toBe("Kick");
    expect(withoutExt("Kick.aiff")).toBe("Kick");
    expect(withoutExt("Kick v2")).toBe("Kick v2");
  });
});
