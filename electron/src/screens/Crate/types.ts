import type { ProjectRow, LibraryItem } from "../../types";

// Crate-digger data contract — a pure projection over the catalog (/api/projects).
export type Daw = "ableton" | "flstudio" | "reaper" | "dawproject" | "audacity" | "unknown";
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
}

export interface CrateGroup {
  key: string;              // stable id, e.g. "genre:House"
  label: string;
  accent: string;           // genre tint, or Sloth Blue for non-genre groups
  projects: Project[];
  count: number;
}

// Genre tints — keyed to EXACTLY the names genre.py emits — used ONLY as fills/tints
// behind near-black text (the brand audit confirms near-black on these is AAA). One
// distinct hue per genre, spread around the wheel so adjacent crates read apart.
export const GENRE_COLOR: Record<string, string> = {
  "Lo-fi": "#C9A98E",      // dusty / vintage tape
  "Boom bap": "#E0A458",   // warm amber
  "Hip hop": "#F5C451",    // gold
  "Trap": "#A86CF0",       // purple
  "Drill": "#7E8CC4",      // indigo steel
  "Phonk": "#C56BE0",      // magenta
  "House": "#86B3D3",      // Sloth Blue
  "Tech house": "#5BB8D6", // cyan-blue
  "Techno": "#9DB0C0",     // muted blue-grey
  "Trance": "#8B7BF0",     // violet
  "UK garage": "#46C7C7",  // teal
  "Grime": "#C2CF4A",      // lime
  "Dubstep": "#6BD66A",    // green
  "DnB": "#F2706E",        // Clip Red
  "Jungle": "#3FB86B",     // forest green
  "Hardstyle": "#FF7A45",  // orange-red
  "Hyperpop": "#F07AD0",   // hot pink
  "Pop": "#F49AC2",        // bubblegum
  "Ambient": "#5BD2B0",    // aqua
  "Unknown": "#677C8B",    // slate grey
};
export const SLOTH_BLUE = "#86B3D3";

const DAW_LABEL: Record<Daw, string> = {
  ableton: "Ableton", flstudio: "FL Studio", reaper: "Reaper",
  dawproject: "DAWproject", audacity: "Audacity", unknown: "DAW",
};
export const dawDisplay = (d: Daw): string => DAW_LABEL[d] ?? "DAW";
const asDaw = (d?: string): Daw =>
  d === "flstudio" || d === "reaper" || d === "dawproject" || d === "audacity"
    || d === "ableton" ? d : "unknown";

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
  };
}
