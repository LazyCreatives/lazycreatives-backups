import { useEffect, useState } from "react";
import { makeApi } from "./api";

// Albums you're putting together: a title, a release date and songs in order.
// SHARED FILE: the same file lives in Backups and Uploader (electron/src/albums.ts).
// Both apps read and change one list, kept on this computer beside the apps' own
// records, so an album made or reordered in one app shows in the other. While a page
// shows albums, the list is checked every few seconds for changes made in the other app.

export interface AlbumSong {
  path: string;
  title: string;
  project: string;               // the project it came from ("" when not known)
  project_id: string | null;     // Backups' id for that project, when Backups knows it
  daw?: string;
  backup: "safe" | "changed" | "none" | null;   // the project's backup, from Backups
  gapless_after: boolean;        // runs straight into the next song, no blend
  ready: boolean | null;         // your own tick (null = let the app judge)
  needs: string[];               // what's still missing, in plain words
  is_ready: boolean;
}

export interface Album {
  id: string;
  title: string;
  release_date: string;          // "2026-11-14", or "" for no date yet
  crossfade: number;             // seconds, 0 to 12
  songs: AlbumSong[];
  created_at: number;
  updated_at: number;
}

export interface AlbumCandidate {
  path: string; title: string; project: string; project_id?: string | null; daw?: string;
  genre?: string; duration?: number | null; posted?: boolean;
}

export interface AlbumSongChange {
  path: string; title?: string; gapless_after?: boolean; ready?: boolean; clear_ready?: boolean;
}

export const MAX_FADE = 12;
export const FADE_PRESETS: { secs: number; label: string; hint: string }[] = [
  { secs: 0, label: "Off", hint: "One after another, as most listeners hear it" },
  { secs: 3, label: "3 s", hint: "A short blend" },
  { secs: 6, label: "6 s", hint: "A medium blend" },
  { secs: 12, label: "12 s", hint: "The longest Spotify and Apple Music allow" },
];

const api = makeApi();
type State = { list: Album[] | null; rev: number; error: string | null };
let state: State = { list: null, rev: -1, error: null };
const subs = new Set<(s: State) => void>();
const tell = (s: State) => { state = s; subs.forEach((f) => f(s)); };
let poll = 0;
let loading: Promise<void> | null = null;

export function loadAlbums(): Promise<void> {
  if (loading) return loading;
  loading = api.listAlbums()
    .then((r) => tell({ list: r.albums, rev: r.rev, error: null }))
    .catch((e) => tell({ ...state, list: state.list ?? [], error: String((e as Error).message) }))
    .finally(() => { loading = null; });
  return loading;
}

async function checkForChanges() {
  try {
    const { rev } = await api.albumsRev();
    if (rev !== state.rev) await loadAlbums();
  } catch { /* the next check will try again */ }
}

export function useAlbums(): State {
  const [s, setS] = useState<State>(state);
  useEffect(() => {
    subs.add(setS);
    void loadAlbums();
    if (subs.size === 1) poll = window.setInterval(() => void checkForChanges(), 3000);
    return () => { subs.delete(setS); if (!subs.size) window.clearInterval(poll); };
  }, []);
  return s;
}

// Put one album back as the app returned it after a change.
function keep(a: Album): Album {
  const list = state.list ?? [];
  const has = list.some((x) => x.id === a.id);
  tell({ ...state, list: has ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a] });
  void checkForChanges();
  return a;
}

// Show a change straight away, then save it; put it back if saving fails.
async function change(id: string, show: (a: Album) => Album, save: () => Promise<Album>): Promise<Album> {
  const before = state.list;
  if (before) tell({ ...state, list: before.map((a) => (a.id === id ? show(a) : a)) });
  try { return keep(await save()); }
  catch (e) { if (before) tell({ ...state, list: before }); throw e; }
}

export const makeAlbum = async (title: string, date = "") => keep(await api.createAlbum(title, date));
export const renameAlbum = (id: string, title: string) =>
  change(id, (a) => ({ ...a, title }), () => api.updateAlbum(id, { title }));
export const setReleaseDate = (id: string, release_date: string) =>
  change(id, (a) => ({ ...a, release_date }), () => api.updateAlbum(id, { release_date }));
export const setCrossfade = (id: string, crossfade: number) =>
  change(id, (a) => ({ ...a, crossfade }), () => api.updateAlbum(id, { crossfade }));
export const addSongs = async (id: string, songs: { path: string; title?: string; project?: string }[]) =>
  keep(await api.addAlbumSongs(id, songs));
export const orderSongs = (id: string, paths: string[]) =>
  change(id, (a) => ({ ...a, songs: paths.map((p) => a.songs.find((s) => s.path === p)!).filter(Boolean) }),
    () => api.orderAlbum(id, paths));
export const takeOut = (id: string, path: string) =>
  change(id, (a) => ({ ...a, songs: a.songs.filter((s) => s.path !== path) }), () => api.removeAlbumSong(id, path));
export const changeSong = (id: string, c: AlbumSongChange) =>
  change(id, (a) => ({ ...a, songs: a.songs.map((s) => s.path !== c.path ? s : {
    ...s, ...(c.title !== undefined ? { title: c.title } : {}),
    ...(c.gapless_after !== undefined ? { gapless_after: c.gapless_after } : {}),
    ...(c.ready !== undefined ? { ready: c.ready, is_ready: c.ready } : {}),
  }) }), () => api.changeAlbumSong(id, c));
export async function deleteAlbum(id: string) {
  await api.deleteAlbum(id);
  tell({ ...state, list: (state.list ?? []).filter((a) => a.id !== id) });
}
export const albumCandidates = () => api.albumCandidates();

// ── words and numbers for the pages ─────────────────────────────────────────────

export function readyCount(a: Album): number { return a.songs.filter((s) => s.is_ready).length; }

// "14 Nov 2026", or "" with no date.
export function fmtRelease(date: string): string {
  if (!date) return "";
  const d = new Date(`${date}T12:00:00`);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// "38 days to go", "Out tomorrow", "Out today", "Came out 3 days ago".
export function daysToGo(date: string, now: Date = new Date()): string {
  if (!date) return "";
  const d = new Date(`${date}T12:00:00`);
  if (isNaN(d.getTime())) return "";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const n = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (n > 1) return `${n} days to go`;
  if (n === 1) return "Out tomorrow";
  if (n === 0) return "Out today";
  return n === -1 ? "Came out yesterday" : `Came out ${-n} days ago`;
}

// The album's state in a word or two, for its pill: Empty, Ready, or what's left.
export function albumState(a: Album): { label: string; tone: "ok" | "warn" | "quiet" } {
  if (!a.songs.length) return { label: "No songs yet", tone: "quiet" };
  const left = a.songs.length - readyCount(a);
  return left ? { label: `${left} to sort`, tone: "warn" } : { label: "Ready", tone: "ok" };
}

export function fadeLabel(secs: number): string {
  return secs <= 0 ? "Off" : `${Number.isInteger(secs) ? secs : secs.toFixed(1)} s`;
}

// Move one item of a list from one place to another.
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}
