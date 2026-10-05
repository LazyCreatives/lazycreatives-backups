// Library search + filters. Every filter is something the Library already shows
// on each project: its DAW, genre, BPM, backup state and latest song.
import type { LibraryItem } from "./types";
import { fuzzyScore } from "./fuzzy";
import { dawLabel } from "./format";
import { keep, recall } from "./desktop";

export type StatusFilter = "all" | "safe" | "changed" | "missing" | "none";
export type SongFilter = "any" | "has" | "soundcloud" | "nosong";

export interface LibFilters {
  q: string;
  status: StatusFilter;
  daw: string;     // "" = any
  genre: string;   // "" = any
  bpm: string;     // "" = any, else a BPM_BANDS key
  song: SongFilter;
}

export const NO_FILTERS: LibFilters = { q: "", status: "all", daw: "", genre: "", bpm: "", song: "any" };

export const BPM_BANDS: { key: string; label: string; lo: number; hi: number }[] = [
  { key: "lt100", label: "Under 100", lo: 0, hi: 100 },
  { key: "100", label: "100–119", lo: 100, hi: 120 },
  { key: "120", label: "120–129", lo: 120, hi: 130 },
  { key: "130", label: "130–149", lo: 130, hi: 150 },
  { key: "150", label: "150–169", lo: 150, hi: 170 },
  { key: "170", label: "170 and up", lo: 170, hi: Infinity },
];

export function itemStatus(it: LibraryItem): Exclude<StatusFilter, "all"> {
  if (it.missing_count > 0) return "missing";
  if (it.changed) return "changed";
  return it.backed_up ? "safe" : "none";
}

export function isFiltered(f: LibFilters): boolean {
  return f.q.trim() !== "" || f.status !== "all" || !!f.daw || !!f.genre || !!f.bpm || f.song !== "any";
}

// Everything but the search box and status (which has its own counted buttons).
export function extraFilterCount(f: LibFilters): number {
  return [f.daw, f.genre, f.bpm, f.song !== "any" ? f.song : ""].filter(Boolean).length;
}

/** Projects that pass the filters (ignoring status when `skipStatus`), best search match first. */
export function applyFilters(items: LibraryItem[], f: LibFilters, skipStatus = false): LibraryItem[] {
  const band = BPM_BANDS.find((b) => b.key === f.bpm);
  const q = f.q.trim();
  const scored: { it: LibraryItem; score: number; i: number }[] = [];
  items.forEach((it, i) => {
    if (!skipStatus && f.status !== "all" && itemStatus(it) !== f.status) return;
    if (f.daw && (it.daw || "") !== f.daw) return;
    if (f.genre && (it.genre || "") !== f.genre) return;
    if (band) {
      const b = it.bpm ? Math.round(it.bpm) : null;
      if (b == null || b < band.lo || b >= band.hi) return;
    }
    if (f.song === "has" && !it.latest_export) return;
    if (f.song === "soundcloud" && !it.latest_export?.uploaded) return;
    if (f.song === "nosong" && it.latest_export) return;
    let score = 1;
    if (q) {
      // the project's own name counts double, so it beats a genre or song hit
      const byName = fuzzyScore(q, [it.name]);
      score = byName ? byName * 2 : fuzzyScore(q, [it.name, it.genre, it.latest_export?.name, dawLabel(it.daw)]);
      if (!score) return;
    }
    scored.push({ it, score, i });
  });
  if (q) scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.it);
}

// Kept so leaving the Library and coming back keeps what you picked. The filters are
// also saved for the next time the app opens; the search text is not, so the list
// never opens half-empty because of something typed last week.
const FILTERS_KEY = "lc-library-filters";
const isFilters = (v: unknown) => !!v && typeof v === "object"
  && (Object.keys(NO_FILTERS) as (keyof LibFilters)[]).every((k) => typeof (v as any)[k] === typeof NO_FILTERS[k]);
let remembered: LibFilters = { ...recall<LibFilters>(FILTERS_KEY, NO_FILTERS, isFilters), q: "" };
export function rememberedFilters(): LibFilters { return remembered; }
export function rememberFilters(f: LibFilters) { remembered = f; keep(FILTERS_KEY, { ...f, q: "" }); }

// ── sorting the Crate table by its column headings ──
export type SortKey = "name" | "song" | "bpm" | "status" | "backup";
export interface LibSort { key: SortKey; dir: 1 | -1 }

// The way each column sorts on its first click: names A to Z, slowest first,
// what needs you first, newest backup first. A second click reverses it.
export const FIRST_DIR: Record<SortKey, 1 | -1> = { name: 1, song: 1, bpm: 1, status: 1, backup: -1 };

const STATUS_RANK = { missing: 0, none: 1, changed: 2, safe: 3 } as const;

function sortValue(it: LibraryItem, key: SortKey): string | number | null {
  switch (key) {
    case "name": return it.name.toLowerCase();
    case "song": return it.latest_export ? it.latest_export.name.toLowerCase() : null;
    case "bpm": return it.bpm ? Math.round(it.bpm) : null;
    case "status": return STATUS_RANK[itemStatus(it)];
    case "backup": return it.last_backup || null;
  }
}

/** Sorted copy; empty values (no song, no BPM, never backed up) always go last. Ties keep their order. */
export function sortItems(items: LibraryItem[], sort: LibSort | null): LibraryItem[] {
  if (!sort) return items;
  return items
    .map((it, i) => ({ it, i, v: sortValue(it, sort.key) }))
    .sort((a, b) => {
      if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
      return c !== 0 ? c * sort.dir : a.i - b.i;
    })
    .map((x) => x.it);
}

// The sort order, saved for the next time the app opens too.
const SORT_KEY = "lc-library-sort";
const isSort = (v: unknown) => v === null
  || (!!v && typeof v === "object" && (v as any).key in FIRST_DIR && ((v as any).dir === 1 || (v as any).dir === -1));
let rememberedSortValue: LibSort | null = recall<LibSort | null>(SORT_KEY, null, isSort);
export function rememberedSort(): LibSort | null { return rememberedSortValue; }
export function rememberSort(s: LibSort | null) { rememberedSortValue = s; keep(SORT_KEY, s); }

// ── opening the Library on a ready-made view from another screen ──
// "See what we gathered" after a first backup, or a count on Home such as "3 safe".
// Search and the other filters are cleared so nothing left over from earlier hides
// the projects the button promised.
export interface LibraryView { status: StatusFilter; newestFirst?: boolean }
export function viewFor(v: LibraryView, sort: LibSort | null): { filters: LibFilters; sort: LibSort | null } {
  return {
    filters: { ...NO_FILTERS, status: v.status },
    sort: v.newestFirst ? { key: "backup", dir: -1 } : sort,
  };
}
// What "See what we gathered" opens: every project, the ones just backed up on top.
export const JUST_BACKED_UP: LibraryView = { status: "all", newestFirst: true };
