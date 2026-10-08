import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Crate Library's columns (library.css): at every width the list can be, the
// project name keeps real room, and every column that steps out leaves the grid as a
// whole (its track and its cells together), so rows keep lining up.
// Before: the narrow rules followed the window (1099px / 1360px) and forgot the sidebar,
// so at the default 1100px window names were squeezed to one letter.

const css = readFileSync(new URL("./library.css", import.meta.url), "utf8");
const block = (src: string, at: number) => src.slice(src.indexOf("{", at) + 1, src.indexOf("}", at));
const vars = (body: string) => Object.fromEntries([...body.matchAll(/(--c-[a-z]+|--cols):\s*([^;]*);/g)].map((m) => [m[1], m[2].trim()]));
const base = vars(block(css, css.indexOf(".lib-cols {")));
// each @container libtable (max-width: N) rule: the variables it sets and the cells it hides
const tiers = [...css.matchAll(/@container libtable \(max-width: (\d+)px\) \{([\s\S]*?)\n\}/g)].map((m) => ({
  max: Number(m[1]), set: vars(m[2]), hide: [...m[2].matchAll(/nth-child\((\d+)\)/g)].map((h) => Number(h[1])),
}));
// which cell (nth-child) each column variable stands for
const CELL: Record<string, number> = { "--c-play": 3, "--c-rating": 7, "--c-song": 8, "--c-bpm": 9, "--c-last": 11 };
const ROW_PAD = 16;   // the table's two 1px borders and the row's 14px right padding
const GAP = 10;

function layout(width: number, extra: Record<string, string> = {}) {
  const v: Record<string, string> = { ...base, ...extra };
  for (const t of tiers) if (width <= t.max) Object.assign(v, t.set);
  const tracks = v["--cols"].replace(/var\((--c-[a-z]+)\)/g, (_, k) => v[k] ?? "").trim().split(/\s+(?![^(]*\))/).filter(Boolean);
  const nameAt = tracks.findIndex((t) => t.includes("1fr"));
  const min = (t: string) => Number((/^(?:minmax\()?(\d+)px/.exec(t) ?? [0, 0])[1]);
  const others = tracks.reduce((n, t, i) => n + (i === nameAt ? 0 : min(t)), 0);
  return { tracks, name: width - ROW_PAD - others - (tracks.length - 1) * GAP, shown: (k: string) => !!v[k] };
}

describe("Library columns (Crate)", () => {
  it("has the steps it is meant to have", () => {
    expect(tiers.length).toBeGreaterThanOrEqual(4);
  });

  it("gives the project name at least 180px from the default window up", () => {
    // the default 1100px window leaves the list about 808px; 1440px about 1144px
    for (let w = 790; w <= 1400; w++) expect(layout(w).name, `list ${w}px wide`).toBeGreaterThanOrEqual(180);
  });

  it("still gives the name room in the smallest window", () => {
    // the 760px minimum window leaves the list about 644px
    for (let w = 640; w < 790; w++) expect(layout(w).name, `list ${w}px wide`).toBeGreaterThanOrEqual(140);
  });

  it("shows the waveform at the default window size", () => {
    expect(layout(808).shown("--c-song")).toBe(true);
    expect(layout(1144).tracks).toHaveLength(13);   // 1440px: every column
  });

  it("hides a column's cells exactly where its track leaves", () => {
    for (const t of tiers) {
      const emptied = Object.entries(t.set).filter(([k, val]) => k in CELL && val === "").map(([k]) => CELL[k]).sort();
      expect([...t.hide].sort(), `max-width ${t.max}px`).toEqual(emptied);
    }
    // and the per-library classes (nothing rated, no songs yet) do the same
    for (const [cls, k] of [["--norating", "--c-rating"], ["--nosongs", "--c-song"]]) {
      const at = css.indexOf(`.lib-cols${cls} {`);
      expect(vars(block(css, at))[k]).toBe("");
      expect(css).toContain(`.lib-cols${cls} > :nth-child(${CELL[k]}) { display: none; }`);
    }
  });
});
