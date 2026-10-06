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

// Light or dark, next to the look: "dark" (the default, as the apps have always been),
// "light" (paper) or "system" (follows the computer's setting, live). Kept on this
// computer as lc-theme and shown as data-theme="light" | "dark" on <html>; the colours
// for each are in lazy-ui.css. public/theme-boot.js sets it before the first paint.
export type ThemeChoice = "dark" | "light" | "system";
export type Theme = "dark" | "light";
export const THEME_KEY = "lc-theme";
const themeSubs = new Set<(c: ThemeChoice) => void>();

export function parseThemeChoice(v: unknown): ThemeChoice {
  return v === "light" || v === "system" ? v : "dark";
}

export function getThemeChoice(): ThemeChoice {
  try { return parseThemeChoice(localStorage.getItem(THEME_KEY)); } catch { return "dark"; }
}

// What a choice comes out as, given whether the computer is set to dark.
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice === "system") return systemDark ? "dark" : "light";
  return choice;
}

const darkQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

// No answer from the computer counts as dark, the apps' own default.
export function systemIsDark(): boolean {
  const q = darkQuery();
  return q ? q.matches : true;
}

// Puts a choice on the page (and tells the window, for its title strip and glass).
export function applyTheme(choice: ThemeChoice = getThemeChoice()): Theme {
  const theme = resolveTheme(choice, systemIsDark());
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
  try {
    const w = typeof window !== "undefined" ? (window as any) : null;
    (w?.ablebackup || w?.lazyupload)?.setTheme?.(choice, theme);
  } catch { /* outside the app (tests, a browser): the page still changes */ }
  return theme;
}

export function setThemeChoice(c: ThemeChoice) {
  try { localStorage.setItem(THEME_KEY, c); } catch { /* still applies for this session */ }
  applyTheme(c);
  themeSubs.forEach((f) => f(c));
}

// The theme the page shows now, and a switch to the other one (Cmd/Ctrl+K "Switch to light").
export function currentTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
export function toggleTheme() { setThemeChoice(currentTheme() === "light" ? "dark" : "light"); }

// [what was picked, set it, what it came out as]
export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void, Theme] {
  const [c, setC] = useState<ThemeChoice>(getThemeChoice);
  const [dark, setDark] = useState(systemIsDark);
  useEffect(() => {
    themeSubs.add(setC);
    const q = darkQuery();
    const f = () => setDark(q ? q.matches : true);
    q?.addEventListener?.("change", f);
    return () => { themeSubs.delete(setC); q?.removeEventListener?.("change", f); };
  }, []);
  return [c, setThemeChoice, resolveTheme(c, dark)];
}

if (typeof document !== "undefined") {
  applyTheme();
  // "Match my computer" follows the computer when it switches (at sunset, say).
  darkQuery()?.addEventListener?.("change", () => { if (getThemeChoice() === "system") applyTheme("system"); });
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
  return picked[genre] ?? builtInColor(genre);
}

// A genre's own colour, before anyone picks one for it.
export function builtInColor(genre: string): string {
  return GENRE_COLORS[genre] ?? SPARE[hash(genre) % SPARE.length];
}

// Crate colours you picked yourself (right-click a genre, or the genre box): they
// beat the built-in colour everywhere that genre shows, as stripes, covers and crates.
// Kept on this computer. The colours on offer are the ones the genres already use, so
// every pick still sits well on the ink background.
export const CRATE_COLORS = ["#E05A5A", "#E0784F", "#F0A35E", "#E8C547", "#C2B04A", "#7FA36B", "#56C08A",
  "#79B8A6", "#4FC3C9", "#5B9BD5", "#7C8CF0", "#B48CF0", "#9B6BD8", "#E0628A", "#F08CD0", "#8C96A3"];
const PICKED = "lc-genre-colors";
let picked: Record<string, string> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(PICKED) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
})();
const colorSubs = new Set<() => void>();
let colorVersion = 0;
// Goes up each time a crate colour changes, for lists that cache their colours.
export const genreColorsVersion = () => colorVersion;

// The colour you picked for a genre, or null when it uses its own.
export function pickedColor(genre: string): string | null { return picked[genre] ?? null; }

// Pick a genre's crate colour; null goes back to the built-in one.
export function setGenreColor(genre: string, hex: string | null) {
  const next = { ...picked };
  if (hex) next[genre] = hex; else delete next[genre];
  picked = next;
  colorVersion++;
  try { localStorage.setItem(PICKED, JSON.stringify(picked)); } catch { /* this session only */ }
  colorSubs.forEach((f) => f());
}

// Call once at the top of the app: redraws everything when a crate colour changes.
export function useGenreColors(): number {
  const [n, setN] = useState(0);
  useEffect(() => { const f = () => setN((x) => x + 1); colorSubs.add(f); return () => { colorSubs.delete(f); }; }, []);
  return n;
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

// Walls of covers deal in one by one the first time one shows; after that, once per
// session, they simply appear (dealing every visit feels like a website, not an app).
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const seen = new MutationObserver(() => {
    if (!document.querySelector(".sleeves")) return;
    seen.disconnect();
    setTimeout(() => document.documentElement.classList.add("lc-dealt"), 900);
  });
  const start = () => seen.observe(document.body, { childList: true, subtree: true });
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
}
