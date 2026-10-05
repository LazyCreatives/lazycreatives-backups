import { useEffect, useState } from "react";

// The app's two looks. "crate" is a DJ-library style (rows with genre stripes and
// waveforms); "sleeve" is cover-art first (cards, album-style pages). The choice is
// kept on this computer and shown as data-look on <html>, so CSS can follow it.
// Same file in Backups and Uploader.
export type Look = "crate" | "sleeve";
const KEY = "lc-look";
const subs = new Set<(l: Look) => void>();

export function getLook(): Look {
  try { return localStorage.getItem(KEY) === "sleeve" ? "sleeve" : "crate"; } catch { return "crate"; }
}

export function setLook(l: Look) {
  try { localStorage.setItem(KEY, l); } catch { /* still applies for this session */ }
  document.documentElement.dataset.look = l;
  subs.forEach((f) => f(l));
}

export function useLook(): [Look, (l: Look) => void] {
  const [l, setL] = useState<Look>(getLook);
  useEffect(() => { subs.add(setL); return () => { subs.delete(setL); }; }, []);
  return [l, setLook];
}

// One colour per genre, used for row stripes, cover art and waveforms.
const GENRE_COLORS: Record<string, string> = {
  "Lo-fi": "#D9B26B", "Boom bap": "#C98F5A", "Hip hop": "#E8C547", "Trap": "#56C08A",
  "Drill": "#7FA36B", "Phonk": "#E0628A", "House": "#4FC3C9", "Tech house": "#3FA7B5",
  "Techno": "#8C96A3", "Trance": "#7C8CF0", "UK garage": "#B48CF0", "Grime": "#5B9BD5",
  "Dubstep": "#9B6BD8", "DnB": "#E0784F", "Jungle": "#C2B04A", "Hardstyle": "#E05A5A",
  "Hyperpop": "#F08CD0", "Pop": "#F0A35E", "Ambient": "#79B8A6",
};
// The genres the apps know, in the order the genre picker lists them.
export const GENRES = Object.keys(GENRE_COLORS);
const SPARE = ["#5B9BD5", "#E0784F", "#B48CF0", "#56C08A", "#E8C547", "#4FC3C9", "#E0628A"];
export const NO_GENRE = "#4A525C";  // no genre yet: a quiet grey stripe

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function genreColor(genre?: string | null): string {
  if (!genre) return NO_GENRE;
  return GENRE_COLORS[genre] ?? SPARE[hash(genre) % SPARE.length];
}

// Cover art colour: the genre's, or for a project with no genre yet, one picked
// from its name so a shelf of untagged projects still looks varied.
export function coverColor(genre: string | null | undefined, name: string): string {
  return genre ? genreColor(genre) : SPARE[hash(name) % SPARE.length];
}

// lighten (f > 0) or darken (f < 0) a #rrggbb colour
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${m(n >> 16)}, ${m((n >> 8) & 255)}, ${m(n & 255)})`;
}

if (typeof document !== "undefined") document.documentElement.dataset.look = getLook();
