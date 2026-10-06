import { describe, expect, it } from "vitest";
import { compare, moreLikeThis, parseKey, soundPrint, tempoGap } from "../src/screens/Crate/similar";
import type { Project } from "../src/screens/Crate/types";

const proj = (id: string, bpm: number | null, genre: string, key: string | null = null, song = true): Project => ({
  id, name: id.toUpperCase(), daw: "ableton", genre, bpm, musicalKey: key, sizeBytes: 0, modifiedAt: "",
  verified: true, snapshots: 1, missing: 0, latest: song ? { path: `/songs/${id}.wav`, name: `${id}.wav` } : null,
});

describe("More like this", () => {
  it("treats half and double time as close", () => {
    expect(tempoGap(70, 140)).toBe(0);
    expect(tempoGap(150, 140)).toBeCloseTo(10 / 140);
  });

  it("reads keys in the usual spellings", () => {
    expect(parseKey("F minor")).toEqual({ pc: 5, minor: true });
    expect(parseKey("Bbm")).toEqual({ pc: 10, minor: true });
    expect(parseKey("A# major")).toEqual({ pc: 10, minor: false });
    expect(parseKey("nonsense")).toBeNull();
  });

  it("ranks same tempo and genre first, and says why", () => {
    const seed = proj("heavy", 150, "Trap", "F minor");
    const all = [seed, proj("twin", 150, "Trap", "F minor"), proj("near", 145, "Trap"), proj("far", 90, "Lo-fi")];
    const out = moreLikeThis(seed, all, new Map());
    expect(out.map((m) => m.project.id)).toEqual(["twin", "near"])  // "far" shares nothing, so it is left out;
    expect(out[0].why).toEqual(["Same tempo", "Same genre", "Same key"]);
    expect(out.find((m) => m.project.id === "heavy")).toBeUndefined();
  });

  it("uses how songs sound when it has heard them", () => {
    const seed = proj("a", 140, "Grime");
    const loud = { loud: -8, bright: 0.1, low: 0.5, punch: 8 };
    const quiet = { loud: -24, bright: 0.02, low: 0.1, punch: 18 };
    const b = proj("b", 140, "Grime"), c = proj("c", 140, "Grime");
    expect(compare(seed, b, loud, loud).score).toBeGreaterThan(compare(seed, c, loud, quiet).score);
    expect(compare(seed, b, loud, loud).why).toContain("As loud");
  });

  it("measures a sine as quiet-ish, dark and not punchy", () => {
    const sr = 44100, ch = new Float32Array(sr * 5);
    for (let i = 0; i < ch.length; i++) ch[i] = 0.5 * Math.sin((2 * Math.PI * 60 * i) / sr);
    const p = soundPrint(ch, sr)!;
    expect(p.loud).toBeCloseTo(-9, 0);
    expect(p.punch).toBeCloseTo(3, 0);
    expect(p.low).toBeGreaterThan(0.6);
    expect(soundPrint(new Float32Array(10), sr)).toBeNull();
  });
});
