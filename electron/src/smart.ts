import { useEffect, useState } from "react";
import { keep, recall } from "./desktop";

// Smart crates: a search and set of filters, saved under a name, that always shows
// what fits right now (a new House project at 124 BPM turns up in "Warm-up House"
// on its own). Kept on this computer. SHARED FILE: the same file lives in Backups
// and Uploader (electron/src/smart.ts); change both together.

export interface SmartCrate<F> {
  id: string;
  name: string;
  filters: F;
}

const key = (scope: string) => `lc-smart-${scope}`;
const subs = new Map<string, Set<() => void>>();
const isList = (v: unknown) => Array.isArray(v) && v.every((c) => c && typeof c.id === "string" && typeof c.name === "string" && c.filters && typeof c.filters === "object");

export function smartCrates<F>(scope: string): SmartCrate<F>[] {
  return recall<SmartCrate<F>[]>(key(scope), [], isList);
}

function write<F>(scope: string, list: SmartCrate<F>[]) {
  keep(key(scope), list);
  subs.get(scope)?.forEach((f) => f());
}

export function saveSmartCrate<F>(scope: string, name: string, filters: F): SmartCrate<F> {
  const crate = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.trim() || "Smart crate", filters };
  write(scope, [...smartCrates<F>(scope), crate]);
  return crate;
}

export function renameSmartCrate(scope: string, id: string, name: string) {
  if (!name.trim()) return;
  write(scope, smartCrates(scope).map((c) => (c.id === id ? { ...c, name: name.trim() } : c)));
}

export function deleteSmartCrate(scope: string, id: string) {
  write(scope, smartCrates(scope).filter((c) => c.id !== id));
}

// Put a deleted crate back where it was (for Undo).
export function restoreSmartCrate<F>(scope: string, crate: SmartCrate<F>, at: number) {
  const list = smartCrates<F>(scope).filter((c) => c.id !== crate.id);
  list.splice(Math.min(at, list.length), 0, crate);
  write(scope, list);
}

// The saved crates, redrawn when one is added, renamed or removed anywhere.
export function useSmartCrates<F>(scope: string): SmartCrate<F>[] {
  const [list, setList] = useState(() => smartCrates<F>(scope));
  useEffect(() => {
    const f = () => setList(smartCrates<F>(scope));
    if (!subs.has(scope)) subs.set(scope, new Set());
    subs.get(scope)!.add(f);
    return () => { subs.get(scope)!.delete(f); };
  }, [scope]);
  return list;
}

// Two sets of filters ask for the same thing (the search text ignoring case and spaces).
export function sameFilters<F extends object>(a: F, b: F): boolean {
  const norm = (f: F) => JSON.stringify(Object.keys(f).sort().map((k) => {
    const v = (f as any)[k];
    return [k, typeof v === "string" ? v.trim().toLowerCase() : v];
  }));
  return norm(a) === norm(b);
}
