import type { LibraryItem, Overview } from "./types";
import { countStatuses, itemStatus } from "./libraryFilter";
import { fmtCount } from "./format";

// What the narrow window shows, worked out from the library and the overview. No React
// in here, so it is easy to test.

// The project you're working on now: the one saved most recently in its music program.
export function currentProject(items: LibraryItem[]): LibraryItem | null {
  return items.reduce<LibraryItem | null>((a, it) => (!a || it.mtime > a.mtime ? it : a), null);
}

// The other projects saved most recently, newest first.
export function recentProjects(items: LibraryItem[], current: LibraryItem | null, n = 6): LibraryItem[] {
  return items
    .filter((it) => !current || it.project_id !== current.project_id)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, n);
}

// "2026-10-05_1503" (the engine's backup stamp, local time) as milliseconds.
export function stampMs(ts: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(ts || "");
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi).getTime();
}

export type Tone = "ok" | "changed" | "look" | "new";
// One project's state in a word or two, and the dot colour for it.
export function projectState(it: LibraryItem): { tone: Tone; word: string; dot: string } {
  switch (itemStatus(it)) {
    case "missing": return { tone: "look", word: `${it.missing_count > 999 ? "999+" : fmtCount(it.missing_count)} missing`, dot: "dot--warn" };
    case "changed": return { tone: "changed", word: "Changed", dot: "dot--accent" };
    case "safe": return { tone: "ok", word: "Safe", dot: "dot--ok" };
    default: return { tone: "new", word: "Not backed up", dot: "" };
  }
}

// The line under the current project's name.
export function currentLine(it: LibraryItem): string {
  const s = itemStatus(it);
  if (s === "missing") return `${fmtCount(it.missing_count)} ${it.missing_count === 1 ? "sample is" : "samples are"} missing`;
  if (s === "changed") return "Saved since its last backup";
  if (s === "safe") return "Backed up and checked";
  return "Not backed up yet";
}

export interface Glance {
  tone: "ok" | "changed" | "look" | "off" | "busy";
  title: string;      // a few words: "All safe", "2 need a look"
  detail: string;     // the line under it
}

// Everything at a glance: one headline for the top of the narrow window.
export function glance(ov: Overview, items: LibraryItem[], busy: { active: boolean; completed: number; total: number }): Glance {
  if (busy.active) {
    return { tone: "busy", title: "Backing up…", detail: busy.total ? `${fmtCount(busy.completed)} of ${fmtCount(busy.total)} done` : "Getting ready" };
  }
  if (!ov.nas.path) return { tone: "off", title: "Backups are off", detail: "Choose where backups go in the app" };
  if (!ov.nas.reachable) return { tone: "look", title: "Backup drive not found", detail: "Plug it in and backups carry on" };
  const c = countStatuses(items);
  // the same "needs a look" count as Home: missing samples plus failed backups
  const warn = new Set(items.filter((i) => i.missing_count > 0).map((i) => i.name));
  const failed = new Set(ov.attention.filter((a) => a.kind === "error" && !warn.has(a.project_name)).map((a) => a.project_name));
  const look = warn.size + failed.size;
  const waiting = c.changed + c.none;
  const detail = items.length === 0 ? "No projects found yet"
    : `${fmtCount(c.safe)} of ${fmtCount(c.all)} projects safe`;
  if (look > 0) return { tone: "look", title: `${fmtCount(look)} ${look === 1 ? "needs" : "need"} a look`, detail };
  if (waiting > 0) return { tone: "changed", title: `${fmtCount(waiting)} waiting for a backup`, detail };
  return { tone: "ok", title: items.length ? "All safe" : "Nothing to back up yet", detail };
}
