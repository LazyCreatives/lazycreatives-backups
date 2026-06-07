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
  const time = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  if (sameDay(dt, now)) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(dt, yesterday)) return `Yesterday ${time}`;
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (dt.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return `${dt.toLocaleDateString([], opts)}, ${time}`;
}

export function fmtInterval(min: number): string {
  if (!min || min <= 0) return "off";
  if (min % 1440 === 0) { const d = min / 1440; return `every ${d} day${d > 1 ? "s" : ""}`; }
  if (min % 60 === 0) { const h = min / 60; return `every ${h} hour${h > 1 ? "s" : ""}`; }
  return `every ${min} min`;
}

// Show a long absolute path compactly: keep the last `keep` segments.
export function shortPath(p: string, keep = 2): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  if (parts.length <= keep) return p;
  return "…/" + parts.slice(-keep).join("/");
}
