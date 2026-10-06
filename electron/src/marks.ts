// Your own marks on things, kept on this computer between launches:
//   - a rating for each project or track, none to five, drawn with the mark you pick
//     in Settings (flames, hearts, records or dots; the star is already the pin)
//   - how tall list rows are in the Crate look, remembered per screen
// SHARED FILE: the same file lives in Backups and Uploader (electron/src/marks.ts).
import { useEffect, useState } from "react";
import { keep, recall } from "./desktop";

// ── ratings ──────────────────────────────────────────────────────────────────

export type Glyph = "flame" | "heart" | "disc" | "dot";
export const GLYPHS: { key: Glyph; label: string }[] = [
  { key: "flame", label: "Flames" }, { key: "heart", label: "Hearts" },
  { key: "disc", label: "Records" }, { key: "dot", label: "Dots" },
];
const RATINGS = "lc-ratings";
const GLYPH = "lc-rating-glyph";
let ratings: Record<string, number> = recall(RATINGS, {}, (v) => !!v && typeof v === "object" && !Array.isArray(v));
let glyph: Glyph = recall<Glyph>(GLYPH, "flame", (v) => GLYPHS.some((g) => g.key === v));
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

export function ratingOf(id: string): number { return ratings[id] ?? 0; }

// 0 takes the rating away.
export function setRating(ids: string | string[], n: number) {
  const next = { ...ratings };
  for (const id of Array.isArray(ids) ? ids : [ids]) { if (n > 0) next[id] = Math.min(5, Math.round(n)); else delete next[id]; }
  ratings = next;
  keep(RATINGS, ratings);
  tell();
}

// A rename gives a project a new id (it comes from where the file is): keep its rating.
export function renameRatings(idMap: Record<string, string>) {
  if (!Object.keys(ratings).some((id) => id in idMap)) return;
  ratings = Object.fromEntries(Object.entries(ratings).map(([id, n]) => [idMap[id] ?? id, n]));
  keep(RATINGS, ratings);
  tell();
}

export function setGlyph(g: Glyph) { glyph = g; keep(GLYPH, g); tell(); }

// Redraws the caller when a rating or the rating mark changes.
export function useRatings(): { rating: (id: string) => number; glyph: Glyph } {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN((x) => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return { rating: ratingOf, glyph };
}

// ── row height ───────────────────────────────────────────────────────────────

// Compact fits more on screen, Comfortable is the usual, Tall gives the waveform room.
export type Density = "compact" | "comfortable" | "tall";
export const DENSITIES: { key: Density; label: string }[] = [
  { key: "compact", label: "Compact" }, { key: "comfortable", label: "Comfortable" }, { key: "tall", label: "Tall" },
];
const isDensity = (v: unknown) => DENSITIES.some((d) => d.key === v);

export function useDensity(screen: string): [Density, (d: Density) => void] {
  const key = `lc-rows-${screen}`;
  const [d, setD] = useState<Density>(() => recall<Density>(key, "comfortable", isDensity));
  return [d, (n: Density) => { keep(key, n); setD(n); }];
}
