// Shared display formatting for the renderer. Keep all human-facing number/date
// formatting here so every screen reads consistently.

export function fmtSize(n: number): string {
  if (!n || n < 0) return "0 B";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + " TB";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " KB";
  return n + " B";
}

// The backend stamps snapshots as "YYYY-MM-DD_HHMM" (local time).
function parseStamp(ts: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function fmtDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  const dt = parseStamp(ts);
  if (!dt) return ts;
  const time = dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  if (sameDay(dt, now)) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(dt, yesterday)) return `Yesterday ${time}`;
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (dt.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return `${dt.toLocaleDateString([], opts)}, ${time}`;
}

export function dawLabel(daw?: string): string {
  return daw === "flstudio" ? "FL Studio"
    : daw === "reaper" ? "Reaper"
    : daw === "dawproject" ? "DAWproject"
    : daw === "audacity" ? "Audacity"
    : daw === "logic" ? "Logic Pro"
    : daw === "studioone" ? "Studio One"
    : daw === "bitwig" ? "Bitwig"
    : daw === "ableton" ? "Ableton" : "Music app";
}

export function fmtClock(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// When the next backup runs: "today 03:05 PM", "tomorrow 03:05 PM" or "Oct 7, 03:05 PM".
export function fmtNext(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, now)) return `today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return `tomorrow ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

export function fmtInterval(min: number): string {
  if (!min || min <= 0) return "off";
  if (min % 1440 === 0) { const d = min / 1440; return `every ${d} day${d > 1 ? "s" : ""}`; }
  if (min % 60 === 0) { const h = min / 60; return `every ${h} hour${h > 1 ? "s" : ""}`; }
  return `every ${min} min`;
}

// A recognisable label for where a scattered sample came from (its source path),
// e.g. /Users/me/Splice/.../kick.wav -> "Splice". Falls back to the parent folder.
export function sourceLabel(path: string): string {
  if (!path) return "—";
  const markers = ["Splice", "User Library", "Downloads", "Desktop", "Documents", "Music", "Samples", "Packs"];
  for (const m of markers) {
    if (path.includes("/" + m + "/") || path.endsWith("/" + m)) return m;
  }
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] || "—");
}

// The folder containing a file path.
export function folderOf(path: string): string {
  return path.replace(/[/\\][^/\\]*$/, "");
}

// Show a long absolute path compactly: keep the last `keep` segments.
export function shortPath(p: string, keep = 2): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  if (parts.length <= keep) return p;
  return "…/" + parts.slice(-keep).join("/");
}

// A plain calendar date (and optionally the time), in the computer's own date and
// clock format: "7 Oct 2026" or "Oct 7, 2026", "14:05" or "2:05 PM". Takes a Date,
// epoch milliseconds, or null. Use this rather than naming a locale on a screen.
export function fmtDay(when: Date | number | null | undefined, opts: { time?: boolean; year?: boolean } = {}): string {
  if (when === null || when === undefined || when === 0) return "—";
  const d = typeof when === "number" ? new Date(when) : when;
  if (isNaN(d.getTime())) return "—";
  const o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (opts.year !== false) o.year = "numeric";
  if (opts.time) { o.hour = "numeric"; o.minute = "2-digit"; }
  return d.toLocaleString([], o);
}

// A count with the computer's own digit grouping: 2441 -> "2,441" (or "2 441"). Use it
// for every count that can reach the thousands (projects, songs, backups, files).
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

// A count for a tight spot (a status cell, a badge): past `max` it reads "999+".
// Put the exact number in a title next to it.
export function fmtCap(n: number, max = 999): string {
  return n > max ? `${fmtCount(max)}+` : fmtCount(n);
}
