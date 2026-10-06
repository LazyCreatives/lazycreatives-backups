import { useEffect, useState } from "react";
import { hash } from "./look";

// Your own cover pictures. Pictures are saved in Settings, Covers; each one is used as a
// background (the drawn sleeve is printed over it) or as the full cover (shown as it is).
// A project or upload gets the picture picked for it, or else a default by the rule:
// "genre" (pictures given to its genre, then the main picture), "mix" (each project keeps
// one picture of those given out) or "one" (the main picture for everything). With no
// pictures saved, every cover stays drawn. Same file in Backups and Uploader; each app
// hands over its own way of reaching its sidecar with setCoverSource().
export type CoverUse = "background" | "full";
export type CoverRule = "genre" | "mix" | "one";
export type CoverStyle = "ink" | "photo" | "strip";
export type CoverPic = {
  id: string; name: string; use: CoverUse; genres: string[]; main: boolean; w: number; h: number;
  url: string; from?: "backups";  // a picture saved in Backups (seen from Uploader)
};
export type CoverChoice = { pic: string | null; use?: CoverUse | null; style?: CoverStyle | null; fx?: number; fy?: number };
export type CoverState = {
  rule: CoverRule; style: CoverStyle; pictures: CoverPic[]; projects: Record<string, CoverChoice>;
  backups?: { pictures: CoverPic[]; projects: Record<string, CoverChoice> } | null;
};
// What a cover is drawn with: the picture, how it is used, and where its square is cut.
export type CoverArt = { src: string; use: CoverUse; style: CoverStyle; w: number; h: number; fx: number; fy: number; pic: string };

export type CoverSource = {
  load(): Promise<CoverState>;
  settings(p: { rule?: CoverRule; style?: CoverStyle }): Promise<CoverState>;
  add(p: { data: string; name: string; use: CoverUse; w: number; h: number }): Promise<CoverState>;
  update(id: string, p: Partial<Pick<CoverPic, "name" | "use" | "genres" | "main">>): Promise<CoverState>;
  remove(id: string): Promise<CoverState>;
  choose(name: string, choice: CoverChoice | null): Promise<CoverState>;
  src(url: string): string;           // a picture's address with the sidecar's host and pass
  pickImage(): Promise<string | null>;  // a file picker for pictures
  readImage(path: string): Promise<string | null>;  // that file as a data URL
};

const EMPTY: CoverState = { rule: "genre", style: "ink", pictures: [], projects: {} };
let state: CoverState = EMPTY;
let source: CoverSource | null = null;
const subs = new Set<(s: CoverState) => void>();

function publish(s: CoverState) {
  state = { ...EMPTY, ...s };
  subs.forEach((f) => f(state));
  return state;
}

export function setCoverSource(s: CoverSource) {
  source = s;
  return reloadCovers();
}
export async function reloadCovers() {
  if (!source) return state;
  try { return publish(await source.load()); } catch { return state; }
}
export function coverSource() { return source; }
export function coverState() { return state; }

export function useCovers(): CoverState {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); setS(state); return () => { subs.delete(setS); }; }, []);
  return s;
}

// Every change goes through here so all covers on screen follow at once.
export async function changeCovers(f: (s: CoverSource) => Promise<CoverState>) {
  if (!source) throw new Error("Covers aren't ready yet");
  return publish(await f(source));
}

function pickBy<T>(list: T[], name: string): T | undefined {
  return list.length ? list[hash(name) % list.length] : undefined;
}

// The default picture for a project with no picture picked for it.
export function defaultPic(s: CoverState, name: string, genre?: string | null): CoverPic | undefined {
  const pics = s.pictures;
  const main = pics.find((p) => p.main);
  if (s.rule === "one") return main;
  if (s.rule === "mix") return pickBy(pics.filter((p) => p.main || p.genres.length > 0), name);
  const g = (genre || "").toLowerCase();
  const forGenre = g ? pics.filter((p) => p.genres.some((x) => x.toLowerCase() === g)) : [];
  return pickBy(forGenre, name) ?? main;
}

function art(s: CoverState, pic: CoverPic, ch?: CoverChoice): CoverArt {
  return {
    src: source ? source.src(pic.url) : pic.url, use: ch?.use || pic.use, style: ch?.style || s.style,
    w: pic.w || 1, h: pic.h || 1, fx: ch?.fx ?? 0.5, fy: ch?.fy ?? 0.5, pic: pic.id,
  };
}

// The picture a project's cover is drawn with, or null for the drawn cover.
// Uploader looks at its own pick first, then the pick made in Backups, then its defaults.
export function resolveCover(s: CoverState, name: string, genre?: string | null): CoverArt | null {
  const own = s.projects[name];
  if (own) {
    if (own.pic === null) return null;
    const p = s.pictures.find((x) => x.id === own.pic);
    if (p) return art(s, p, own);
  }
  const b = s.backups?.projects?.[name];
  if (b && !own) {
    if (b.pic === null) return null;
    const p = s.backups?.pictures.find((x) => x.id === b.pic);
    if (p) return art(s, p, b);
  }
  const d = defaultPic(s, name, genre);
  return d ? art(s, d) : null;
}

export function useCoverArt(name: string, genre?: string | null): CoverArt | null {
  const s = useCovers();
  return resolveCover(s, name, genre);
}

// Shrink a picture so its longest side is at most `max` px; returns the data and size.
export async function shrinkImage(dataUrl: string, max = 1600): Promise<{ data: string; w: number; h: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const png = /^data:image\/png/.test(dataUrl);
  if (k === 1 && /^data:image\/(jpeg|png|webp)/.test(dataUrl)) return { data: dataUrl, w, h };
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return { data: c.toDataURL(png ? "image/png" : "image/jpeg", 0.9), w, h };
}

// Ask for a picture file and save it; returns the new picture's id (or null if cancelled).
export async function addPictureFromFile(use: CoverUse = "background"): Promise<string | null> {
  if (!source) return null;
  const path = await source.pickImage();
  if (!path) return null;
  const raw = await source.readImage(path);
  if (!raw) throw new Error("That picture couldn't be read. Try a JPG, PNG or WebP under 20 MB.");
  const { data, w, h } = await shrinkImage(raw);
  const name = (path.split(/[\\/]/).pop() || "Picture").replace(/\.[^.]+$/, "").slice(0, 80);
  const before = new Set(state.pictures.map((p) => p.id));
  const s = await changeCovers((src) => src.add({ data, name, use, w, h }));
  return s.pictures.find((p) => !before.has(p.id))?.id ?? null;
}
