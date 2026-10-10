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
  genre?: string;                // its project's genre in Backups, else the one it was added with
  backup: "safe" | "changed" | "none" | null;   // the project's backup, from Backups
  bpm?: number | null;           // its project's tempo, from Backups
  working?: boolean;             // its project was saved after this export: still being worked on
  gapless_after: boolean;        // runs straight into the next song, no blend
  ready: boolean | null;         // your own tick (null = let the app judge)
  needs: string[];               // what's still missing, in plain words
  is_ready: boolean;
}

// Where the album is on SoundCloud, written by Uploader when it syncs the album.
export interface AlbumLink {
  playlist_id: number;
  url: string | null;
  sharing: "public" | "private";
  synced_at: string;             // ISO time of the last sync
  on: number;                    // songs in the playlist
  of: number;                    // songs on the album then
  waiting?: string[];            // songs left off until they're Ready
  older?: string[];              // songs whose older version is what's on SoundCloud
  failed?: string[];             // songs that couldn't go up
}

export interface Album {
  id: string;
  title: string;
  release_date: string;          // "2026-11-14", or "" for no date yet
  crossfade: number;             // seconds, 0 to 12
  kind?: AlbumKind | "";         // what the producer calls it; "" = go by its length
  songs: AlbumSong[];
  soundcloud?: AlbumLink | null;
  created_at: number;
  updated_at: number;
}

export interface AlbumCandidate {
  path: string; title: string; project: string; project_id?: string | null; daw?: string;
  genre?: string; duration?: number | null; posted?: boolean;
  bpm?: number | null;
  exported?: number | null;      // when the file was saved, in seconds
  saved?: number | null;         // when its project was last saved, in seconds
}

// One project's songs for the album picker: its newest proper mixdown first, the
// rest (older versions, an "OLD" or "test" copy) behind it. Songs no project claims
// stand on their own.
export interface CandidateGroup { key: string; main: AlbumCandidate; more: AlbumCandidate[] }
const LESSER = /\b(old|older|test|draft|backup|copy|unused|alt|rough)\b/i;
const SAVED_AFTER = 120;  // seconds: a save this soon after the export is the same session

export function groupCandidates(list: AlbumCandidate[]): CandidateGroup[] {
  const by = new Map<string, AlbumCandidate[]>();
  for (const c of list) {
    const key = c.project_id || (c.project ? `p:${c.project.toLowerCase()}` : `f:${c.path}`);
    const g = by.get(key);
    if (g) g.push(c); else by.set(key, [c]);
  }
  const out: CandidateGroup[] = [];
  for (const [key, songs] of by) {
    songs.sort((a, b) => Number(LESSER.test(a.title)) - Number(LESSER.test(b.title)) || (b.exported ?? 0) - (a.exported ?? 0));
    out.push({ key, main: songs[0], more: songs.slice(1) });
  }
  const newest = (g: CandidateGroup) => Math.max(...[g.main, ...g.more].map((c) => c.exported ?? 0));
  return out.sort((a, b) => newest(b) - newest(a) || a.main.title.localeCompare(b.main.title));
}

// Saved after its newest export: the project is still being worked on.
export const stillWorking = (c: AlbumCandidate) => !!(c.saved && c.exported && c.saved > c.exported + SAVED_AFTER);

// Spotify and Apple Music call a release a single, EP or album by its songs and length.
export type ReleaseKind = "single" | "EP" | "album";
export function releaseKind(songs: number, secs: number): ReleaseKind {
  if (songs >= 7 || secs >= 30 * 60) return "album";
  return songs >= 4 ? "EP" : "single";
}

// What the producer can call it. LP means the same as album (from 12-inch "long play"
// vinyl); a mixtape is a looser set; a compilation gathers songs already out.
export type AlbumKind = ReleaseKind | "LP" | "mixtape" | "compilation";
export const KINDS: { kind: AlbumKind; name: string; rule: string }[] = [
  { kind: "single", name: "Single", rule: "1 to 3 songs, under 30 minutes." },
  { kind: "EP", name: "EP", rule: "4 to 6 songs, under 30 minutes. Short for extended play." },
  { kind: "album", name: "Album", rule: "7 or more songs, or 30 minutes and over." },
  { kind: "LP", name: "LP", rule: "The same as an album. Short for long play, from 12-inch vinyl. Whether it has a theme is up to you." },
  { kind: "mixtape", name: "Mixtape", rule: "A looser set of songs with no overall theme. Stores still list it as a single, EP or album by its length." },
  { kind: "compilation", name: "Compilation", rule: "Songs that are already out, gathered together." },
];
export const kindName = (k: AlbumKind) => KINDS.find((x) => x.kind === k)?.name ?? "Album";
// "An EP", "An album", "A single": how the planning box says it.
export const withArticle = (k: AlbumKind) => `${/^(EP|album|LP)$/.test(k) ? "An" : "A"} ${k === "EP" || k === "LP" ? k : k.toLowerCase()}`;

// A change of tempo from one song to the next that a listener will notice. Half and
// double time count as the same tempo (87 into 174 flows).
export function tempoJump(from?: number | null, to?: number | null): number | null {
  if (!from || !to) return null;
  const d = Math.min(Math.abs(to - from), Math.abs(to * 2 - from), Math.abs(to / 2 - from));
  return d > 8 && d / from > 0.06 ? Math.round(to - from) : null;
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
export const setKind = (id: string, kind: AlbumKind | "") =>
  change(id, (a) => ({ ...a, kind }), () => api.updateAlbum(id, { kind }));
export const addSongs = async (id: string, songs: { path: string; title?: string; project?: string; genre?: string }[]) =>
  keep(await api.addAlbumSongs(id, songs));
export const orderSongs = (id: string, paths: string[]) =>
  change(id, (a) => ({ ...a, songs: paths.map((p) => a.songs.find((s) => s.path === p)!).filter(Boolean) }),
    () => api.orderAlbum(id, paths));
export const takeOut = (id: string, path: string) =>
  change(id, (a) => ({ ...a, songs: a.songs.filter((s) => s.path !== path) }), () => api.removeAlbumSong(id, path));
// Undo "Take off this album": the song goes back in its old place (`order` is the
// running order before it came off) with its own ticks: marked ready or not, and
// whether it ran straight into the next song.
export async function putBack(id: string, s: AlbumSong, order: string[]): Promise<Album> {
  await addSongs(id, [{ path: s.path, title: s.title, project: s.project, genre: s.genre }]);
  let a = await orderSongs(id, order);
  const c: AlbumSongChange = { path: s.path };
  if (s.gapless_after) c.gapless_after = true;
  if (s.ready !== null) c.ready = s.ready;
  if (c.gapless_after !== undefined || c.ready !== undefined) a = await changeSong(id, c);
  return a;
}
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
// Use a newer export in a song's place (it keeps its place, title and join).
export const swapSong = async (id: string, path: string, newPath: string) => keep(await api.swapAlbumSong(id, path, newPath));

// ── newer exports ──────────────────────────────────────────────────────────────

// A file name with its version words taken off: "Night Drive v3 (Master) 2.wav" -> "night drive".
const VERSION_WORDS = /^(v\d+|version|final|finished|master(ed)?|mix(down|ed)?|export(ed)?|bounce|render|wav|mp3|aiff?|flac|new|latest|\d+)$/;
export function songWords(path: string): string[] {
  const stem = (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "").toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, " ");
  return stem.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !VERSION_WORDS.test(w));
}

// Two files of the same song: most of the shorter name's words are in the other one.
export function sameSong(a: string, b: string): boolean {
  const x = new Set(songWords(a)), y = new Set(songWords(b));
  if (!x.size || !y.size) return true;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  let n = 0;
  for (const w of small) if (big.has(w)) n++;
  return n / small.size >= 0.5;
}

const LOSSLESS = /\.(wav|wave|aiff?|aifc|flac)$/i;
const NEWER_BY = 5 * 60;   // seconds: renders this close together are one export (a WAV and an MP3)

// A newer export of this album song from the same project, or null. Only a real
// re-export counts: later by more than a few minutes, the same song by its name, not
// an "old" or "test" copy, and never a lossy file in place of a lossless one.
export function newerExport(s: AlbumSong, candidates: AlbumCandidate[], onAlbum?: Set<string>): AlbumCandidate | null {
  const own = candidates.find((c) => c.path === s.path);
  const project = s.project_id || own?.project_id;
  if (!own?.exported || !project) return null;
  let best: AlbumCandidate | null = null;
  for (const c of candidates) {
    if (c.path === s.path || onAlbum?.has(c.path) || c.project_id !== project || !c.exported || c.exported <= own.exported + NEWER_BY) continue;
    if (LESSER.test(c.title) || !sameSong(c.path, s.path)) continue;
    if (LOSSLESS.test(s.path) && !LOSSLESS.test(c.path)) continue;
    if (!best || c.exported > (best.exported ?? 0)) best = c;
  }
  return best;
}

// The songs the album could use, read once per page and again when asked.
let cands: { list: AlbumCandidate[] | null; at: number } = { list: null, at: 0 };
let candsLoading: Promise<AlbumCandidate[]> | null = null;
export function useCandidates(fresh = 60_000): AlbumCandidate[] | null {
  const [list, setList] = useState(cands.list);
  useEffect(() => {
    if (cands.list && Date.now() - cands.at < fresh) return;
    candsLoading ??= api.albumCandidates().then((l) => { cands = { list: l, at: Date.now() }; return l; })
      .catch(() => cands.list ?? []).finally(() => { candsLoading = null; });
    let live = true;
    void candsLoading.then((l) => { if (live) setList(l); });
    return () => { live = false; };
  }, [fresh]);
  return list;
}

// ── will each song play anywhere (format, bitrate, clipping, loudness) ─────────

export interface SongProblem { short: string; what: string; fix: string }
export interface SongCheck {
  path: string;
  state: "ok" | "check" | "missing" | "unreadable";
  summary: string;               // "WAV · 24-bit · 44.1 kHz"
  problems: SongProblem[];
  lufs: number | null;
  true_peak_db: number | null;
}

// Each file is read once by the app (and kept with the album list); here each answer
// is kept for a minute, so a re-export of the same file is seen soon after.
const checks = new Map<string, { at: number; check: SongCheck | null; wait?: Promise<SongCheck | null> }>();
const checkSubs = new Set<() => void>();
function askCheck(path: string): void {
  const had = checks.get(path);
  if (had?.wait || (had && Date.now() - had.at < 60_000)) return;
  const wait = api.checkAlbumSong(path).catch(() => null);
  checks.set(path, { at: had?.at ?? 0, check: had?.check ?? null, wait });
  void wait.then((check) => { checks.set(path, { at: Date.now(), check }); checkSubs.forEach((f) => f()); });
}
export function useSongChecks(paths: string[]): Record<string, SongCheck | null | undefined> {
  const [, bump] = useState(0);
  const key = paths.join("\n");
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    checkSubs.add(f);
    for (const p of paths) askCheck(p);
    return () => { checkSubs.delete(f); };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  const out: Record<string, SongCheck | null | undefined> = {};
  for (const p of paths) { const c = checks.get(p); out[p] = c && !c.wait ? c.check : c?.check ?? undefined; }
  return out;
}

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

// Where release day is: 1 still to come, 0 today, -1 already out (null with no date).
// The OUT NOW stamp is pressed on the day and stays on the cover after.
export function releaseDay(date: string, now: Date = new Date()): -1 | 0 | 1 | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00`);
  if (isNaN(d.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const n = Math.round((d.getTime() - today.getTime()) / 86400000);
  return n > 0 ? 1 : n === 0 ? 0 : -1;
}

// The genre most of the album's songs share (the first one wins a tie), or "" when
// none has one. It colours the album's stripe, like a genre stripe on a song.
export function mainGenre(a: Album): string {
  const n = new Map<string, number>();
  for (const s of a.songs) if (s.genre) n.set(s.genre, (n.get(s.genre) ?? 0) + 1);
  let best = "", most = 0;
  for (const [g, c] of n) if (c > most) { best = g; most = c; }
  return best;
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
