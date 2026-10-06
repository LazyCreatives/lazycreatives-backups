import type { ProjectRow, LibraryItem } from "../../types";
import { coverColor } from "../../look";
import { itemStatus } from "../../libraryFilter";

// Crate-digger data contract — a pure projection over the catalog (/api/projects).
export type Daw = "ableton" | "flstudio" | "reaper" | "dawproject" | "audacity" | "logic" | "studioone" | "bitwig" | "unknown";
export type GroupBy = "genre" | "daw" | "tempo" | "recency";
export type CrateSort = "count" | "name" | "recent";
export type DigSort = "recent" | "name" | "bpm" | "size";

export interface Project {
  id: string;
  name: string;
  daw: Daw;
  genre: string;            // free-form from the genre guesser; "Unknown" fallback
  genreEmoji?: string;
  bpm: number | null;       // from the parse; null if unknown
  musicalKey: string | null;// not in the catalog yet → null (rendered as "—")
  sizeBytes: number;
  modifiedAt: string;       // catalog timestamp "YYYY-MM-DD_HHMM" (see parseStamp)
  verified: boolean;        // proxy: has a backup (refine to snapshot.verified later)
  snapshots: number;
  missing: number;          // samples the last scan couldn't find (crate trust layer)
  status?: "safe" | "changed" | "missing" | "none";  // the same state the Library and Home count
  latest?: { path: string; name: string } | null;  // newest song exported from it, if any
  exports?: number;
}

export interface CrateGroup {
  key: string;              // stable id, e.g. "genre:House"
  label: string;
  accent: string;           // genre tint, or Sloth Blue for non-genre groups
  projects: Project[];
  count: number;
}

// Genre colours come from look.ts (genreColor), the same ones the rest of the app uses.
export const SLOTH_BLUE = "#86B3D3";

const DAW_LABEL: Record<Daw, string> = {
  ableton: "Ableton", flstudio: "FL Studio", reaper: "Reaper",
  dawproject: "DAWproject", audacity: "Audacity", logic: "Logic Pro",
  studioone: "Studio One", bitwig: "Bitwig", unknown: "DAW",
};
export const dawDisplay = (d: Daw): string => DAW_LABEL[d] ?? "DAW";
const asDaw = (d?: string): Daw =>
  d === "flstudio" || d === "reaper" || d === "dawproject" || d === "audacity"
    || d === "logic" || d === "studioone" || d === "bitwig" || d === "ableton" ? d : "unknown";

// Catalog timestamps are "YYYY-MM-DD_HHMM" (default_timestamp), which Date.parse can't
// read — parse it explicitly, tolerating ISO too. Returns epoch ms (0 if unparseable).
export function parseStamp(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(s || "");
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

// Adapt a backed-up project (/api/projects, has genre/bpm) to the Project shape.
export function toProject(r: ProjectRow): Project {
  return {
    id: r.project_name,
    name: r.project_name,
    daw: asDaw(r.daw),
    genre: r.genre || "Unknown",
    genreEmoji: r.genre_emoji,
    bpm: r.bpm ?? null,
    musicalKey: null,
    sizeBytes: r.total_size ?? 0,
    modifiedAt: r.last_timestamp,
    verified: (r.snapshot_count ?? 0) > 0,
    snapshots: r.snapshot_count ?? 0,
    missing: 0,
  };
}

// Adapt a DISCOVERED project (/api/library — every scanned project, backed up or not)
// to the Project shape. Genre/BPM are guessed at scan time and stored on the library.
export function toProjectFromLibrary(it: LibraryItem): Project {
  return {
    id: it.project_id,
    name: it.name,
    daw: asDaw(it.daw),
    genre: it.genre || "Unknown",
    genreEmoji: it.genre_emoji ?? undefined,
    bpm: it.bpm ?? null,
    musicalKey: null,
    sizeBytes: it.size ?? 0,
    // st_mtime is epoch seconds → ISO (parseStamp handles ISO as well as the catalog stamp)
    modifiedAt: it.mtime ? new Date(it.mtime * 1000).toISOString() : "",
    verified: !!it.backed_up,
    snapshots: it.snapshot_count ?? 0,
    missing: it.missing_count ?? 0,
    status: itemStatus(it),
    latest: it.latest_export ? { path: it.latest_export.path, name: it.latest_export.name } : null,
    exports: it.export_count ?? 0,
  };
}

// A record's colour: the same one its drawn cover uses, so a project looks alike everywhere.
export const genreOf = (p: Project): string | null => (p.genre && p.genre !== "Unknown" ? p.genre : null);
export const tintOf = (p: Project): string => coverColor(genreOf(p), p.name);

// What a crate is called on screen ("Unknown" crates hold projects with no genre/tempo yet).
export const crateName = (label: string): string =>
  label === "Unknown" ? "No genre yet" : label === "Unknown BPM" ? "No tempo yet" : label;
