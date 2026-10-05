// Pinned projects: the few you're finishing right now, kept at the top of the Library
// and on Home. Remembered on this computer between launches (lc-pinned).
import { useEffect, useState } from "react";
import { keep, recall } from "./desktop";

const KEY = "lc-pinned";
let pinned: string[] = recall<string[]>(KEY, [], (v) => Array.isArray(v) && v.every((x) => typeof x === "string"));
const subs = new Set<(p: string[]) => void>();

export function isPinned(id: string): boolean { return pinned.includes(id); }

export function togglePin(id: string) {
  pinned = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
  keep(KEY, pinned);
  subs.forEach((f) => f(pinned));
}

export function setPins(ids: string[], on: boolean) {
  pinned = on ? [...pinned, ...ids.filter((id) => !pinned.includes(id))] : pinned.filter((x) => !ids.includes(x));
  keep(KEY, pinned);
  subs.forEach((f) => f(pinned));
}

// A rename gives a project a new id (it comes from where the file is): keep its pin.
export function renamePins(idMap: Record<string, string>) {
  if (!pinned.some((id) => id in idMap)) return;
  pinned = pinned.map((id) => idMap[id] ?? id);
  keep(KEY, pinned);
  subs.forEach((f) => f(pinned));
}

export function usePins(): string[] {
  const [p, setP] = useState(pinned);
  useEffect(() => { subs.add(setP); return () => { subs.delete(setP); }; }, []);
  return p;
}

// Pinned ones first, in the order they were pinned; everything else keeps its order.
export function pinnedFirst<T extends { project_id: string }>(items: T[], pins: string[]): T[] {
  if (!pins.length) return items;
  const at = new Map(pins.map((id, i) => [id, i]));
  const top = items.filter((i) => at.has(i.project_id)).sort((a, b) => at.get(a.project_id)! - at.get(b.project_id)!);
  return [...top, ...items.filter((i) => !at.has(i.project_id))];
}
