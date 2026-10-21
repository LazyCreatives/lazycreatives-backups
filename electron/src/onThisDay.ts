// "On this day": a project last saved on today's date in an earlier year, for one quiet
// line on Home. The library knows when each project was last saved (mtime, read by the
// scan), not when it was made, so the line says "last saved". Read only.
export interface DayPick<T> { item: T; year: number }

export function onThisDay<T extends { name: string; mtime: number }>(items: T[], now: Date = new Date()): DayPick<T> | null {
  const m = now.getMonth(), d = now.getDate(), y = now.getFullYear();
  let best: DayPick<T> | null = null;
  for (const it of items) {
    if (!it.mtime) continue;
    const t = new Date(it.mtime * 1000);
    if (t.getMonth() !== m || t.getDate() !== d || t.getFullYear() >= y) continue;
    // the oldest one wins (the longest ago), then the name, so the pick stays put all day
    const year = t.getFullYear();
    if (!best || year < best.year || (year === best.year && it.name.localeCompare(best.item.name) < 0)) best = { item: it, year };
  }
  return best;
}
