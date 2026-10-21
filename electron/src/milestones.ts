import { keep, recall } from "./desktop";

// Record-style milestones for safe projects, like a record going gold: the first time
// the Safe count reaches each one, Home says one line about it, once. A small disc then
// sits by the Safe count while the count stays there. Kept in this computer's settings
// (localStorage); if those can't be read or written, the disc still shows but the line
// stays quiet, so it never repeats on every visit.
export type Tier = "gold" | "platinum" | "diamond";
export interface Milestone { at: number; tier: Tier; line: string; title: string }

export const MILESTONES: Milestone[] = [
  { at: 100, tier: "gold", line: "100 projects safe. That's gold.", title: "Gold: 100 projects safe" },
  { at: 250, tier: "gold", line: "250 projects safe. Gold, and still going.", title: "Gold: 250 projects safe" },
  { at: 500, tier: "platinum", line: "500 projects safe. That's platinum.", title: "Platinum: 500 projects safe" },
  { at: 1000, tier: "diamond", line: "1,000 projects safe. Diamond.", title: "Diamond: 1,000 projects safe" },
];

const KEY = "lc-milestones-seen";

// The highest milestone this many safe projects has reached, if any.
export function reached(safe: number): Milestone | null {
  let m: Milestone | null = null;
  for (const x of MILESTONES) if (safe >= x.at) m = x;
  return m;
}

// The milestone to announce now: the highest one reached that is past every one already
// seen (crossing several at once announces only the highest). Null when there's nothing new.
export function fresh(safe: number, seen: number[]): Milestone | null {
  const top = reached(safe);
  const best = seen.length ? Math.max(...seen) : 0;
  return top && top.at > best ? top : null;
}

const validSeen = (v: unknown) => Array.isArray(v) && v.every((n) => typeof n === "number");

function storageWorks(): boolean {
  try {
    localStorage.setItem("lc-probe", "1");
    localStorage.removeItem("lc-probe");
    return true;
  } catch {
    return false;
  }
}

// Check once per load: returns the line to show (and remembers it as shown), or null.
export function announce(safe: number): Milestone | null {
  if (safe < MILESTONES[0].at || !storageWorks()) return null;
  const seen = recall<number[]>(KEY, [], validSeen);
  const m = fresh(safe, seen);
  if (!m) return null;
  keep(KEY, [...new Set([...seen, ...MILESTONES.filter((x) => x.at <= safe).map((x) => x.at)])]);
  return m;
}
