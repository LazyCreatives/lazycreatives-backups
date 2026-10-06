import { useMemo } from "react";
import type { Project, CrateGroup, GroupBy, CrateSort } from "../types";
import { SLOTH_BLUE, dawDisplay, genreOf, parseStamp } from "../types";
import { genreColor, genreColorsVersion } from "../../../look";

const DAY = 86400000;
const daysSince = (s: string, now: number) => {
  const t = parseStamp(s);
  return t === 0 ? Infinity : (now - t) / DAY;
};

function bucket(p: Project, by: GroupBy, now: number): { key: string; label: string } {
  switch (by) {
    case "genre": return { key: `genre:${p.genre}`, label: p.genre };
    case "daw": return { key: `daw:${p.daw}`, label: dawDisplay(p.daw) };
    case "tempo": {
      const b = p.bpm ?? 0;
      const label = b <= 0 ? "Unknown BPM"
        : b <= 90 ? "≤90 BPM" : b <= 120 ? "91–120 BPM" : b <= 140 ? "121–140 BPM" : "140+ BPM";
      return { key: `tempo:${label}`, label };
    }
    case "recency": {
      const d = daysSince(p.modifiedAt, now);
      const label = d <= 7 ? "This week" : d <= 30 ? "This month" : "Older";
      return { key: `recency:${label}`, label };
    }
  }
}

// Pure: bucket + sort projects into crates. Exported separately so it's unit-testable
// without React; useCrates just memoises it. `now` is injectable for deterministic tests.
export function groupCrates(
  projects: Project[], by: GroupBy, sort: CrateSort, search: string, now = Date.now(),
): CrateGroup[] {
  const q = search.trim().toLowerCase();
  const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  const map = new Map<string, CrateGroup>();
  for (const p of filtered) {
    const { key, label } = bucket(p, by, now);
    let g = map.get(key);
    if (!g) {
      const accent = by === "genre" ? genreColor(genreOf(p)) : SLOTH_BLUE;
      g = { key, label, accent, projects: [], count: 0 };
      map.set(key, g);
    }
    g.projects.push(p);
    g.count++;
  }
  const arr = [...map.values()];
  const minDays = (g: CrateGroup) => Math.min(...g.projects.map((p) => daysSince(p.modifiedAt, now)));
  // "Unknown" crates (no genre / no tempo) always go last, whatever the sort.
  const unknown = (g: CrateGroup) => (g.label.startsWith("Unknown") ? 1 : 0);
  arr.sort((a, b) =>
    unknown(a) - unknown(b)
    || (sort === "name" ? a.label.localeCompare(b.label)
    : sort === "recent" ? minDays(a) - minDays(b)
    : b.count - a.count));
  return arr;
}

export function useCrates(projects: Project[], by: GroupBy, sort: CrateSort, search: string): CrateGroup[] {
  const colours = genreColorsVersion();  // a crate colour you picked
  return useMemo(() => groupCrates(projects, by, sort, search), [projects, by, sort, search, colours]);
}
