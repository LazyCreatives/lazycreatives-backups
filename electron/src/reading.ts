import { useEffect, useState } from "react";

// Easier reading (Settings > Look): one switch for people with dyslexia or tired eyes,
// with a few fine-tunes under it. What it does follows the research in
// /mnt/project-files/reading-view/research.md: wider gaps between letters and words,
// bigger text, a plain upright face whose letters can't be mixed up, no capitals-only
// labels or slanted text, and less movement. Kept on this computer as lc-reading and
// shown on <html> as data-reading, data-read-font, data-read-space and data-read-tint,
// so reading.css can follow it; text size is the window's zoom. public/theme-boot.js
// puts it on before the first paint. Same file in Backups and Uploader.
export type ReadFont = "app" | "atkinson" | "opendyslexic";
export type ReadSpace = "normal" | "wider" | "widest";
export type ReadTint = "none" | "cream" | "blue" | "grey";
export interface Reading { on: boolean; size: number; font: ReadFont; space: ReadSpace; tint: ReadTint; calm: boolean }

export const READING_KEY = "lc-reading";
export const SIZES = [1, 1.1, 1.15, 1.25, 1.35, 1.5] as const;
// What the switch turns on the first time; the fine-tunes remember changes after that.
export const READING_DEFAULT: Reading = { on: false, size: 1.15, font: "atkinson", space: "wider", tint: "none", calm: true };

const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export function parseReading(raw: unknown): Reading {
  let o: any = {};
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw || {}; } catch { o = {}; }
  const d = READING_DEFAULT;
  const size = typeof o.size === "number" ? Math.min(1.5, Math.max(1, o.size)) : d.size;
  return {
    on: o.on === true,
    size,
    font: pick(o.font, ["app", "atkinson", "opendyslexic"] as const, d.font),
    space: pick(o.space, ["normal", "wider", "widest"] as const, d.space),
    tint: pick(o.tint, ["none", "cream", "blue", "grey"] as const, d.tint),
    calm: typeof o.calm === "boolean" ? o.calm : d.calm,
  };
}

export function getReading(): Reading {
  try { return parseReading(localStorage.getItem(READING_KEY)); } catch { return { ...READING_DEFAULT }; }
}

// Puts a setting on the page, and the text size on the window.
export function applyReading(r: Reading = getReading()) {
  if (typeof document !== "undefined") {
    const h = document.documentElement;
    if (r.on) {
      h.dataset.reading = "on";
      h.dataset.readFont = r.font;
      h.dataset.readSpace = r.space;
      h.dataset.readTint = r.tint;
      if (r.calm) h.dataset.readCalm = "on"; else delete h.dataset.readCalm;
    } else {
      for (const k of ["reading", "readFont", "readSpace", "readTint", "readCalm"]) delete (h.dataset as any)[k];
    }
  }
  try {
    const w = typeof window !== "undefined" ? (window as any) : null;
    (w?.ablebackup || w?.lazyupload)?.setZoom?.(r.on ? r.size : 1);
  } catch { /* outside the app (tests, a browser): the rest still applies */ }
}

const subs = new Set<(r: Reading) => void>();

export function setReading(r: Reading) {
  try { localStorage.setItem(READING_KEY, JSON.stringify(r)); } catch { /* still applies for this session */ }
  applyReading(r);
  subs.forEach((f) => f(r));
}

export function useReading(): [Reading, (r: Reading) => void] {
  const [r, setR] = useState<Reading>(getReading);
  useEffect(() => { subs.add(setR); return () => { subs.delete(setR); }; }, []);
  return [r, setReading];
}

// The computer asks for less movement, or Easier reading does.
export function wantsStill(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.readCalm === "on") return true;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
