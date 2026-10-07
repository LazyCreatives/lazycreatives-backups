// Recently opened: the projects (Backups) or tracks (Uploader) you opened last, newest
// first, shown in the sidebar and at the top of Find anything (Cmd/Ctrl+K). Only kept
// on this computer, between launches (lc-recents); nothing is sent anywhere.
// SHARED FILE: the same file lives in Backups and Uploader (electron/src/recents.ts);
// change both together.
import { useEffect, useState } from "react";
import { keep, recall } from "./desktop";

export interface Recent {
  id: string;             // a project's id (Backups) or a track's id (Uploader)
  name: string;           // what it was called when opened
  cover: string;          // the name its cover art is drawn from
  genre?: string | null;
  at: number;             // when it was opened (ms)
}

const KEY = "lc-recents";
const MAX = 12;
const valid = (v: unknown) => Array.isArray(v) && v.every((r) => r && typeof r.id === "string" && typeof r.name === "string" && typeof r.at === "number");
let recents: Recent[] = recall<Recent[]>(KEY, [], valid);
const subs = new Set<(r: Recent[]) => void>();
const save = (next: Recent[]) => { recents = next; keep(KEY, recents); subs.forEach((f) => f(recents)); };

// Something was opened: it moves to the top of the list.
export function noteOpened(r: Omit<Recent, "at">, now = Date.now()) {
  if (recents[0]?.id === r.id && recents[0].name === r.name && recents[0].genre === r.genre && now - recents[0].at < 60_000) return;
  save([{ ...r, at: now }, ...recents.filter((x) => x.id !== r.id)].slice(0, MAX));
}

export function forgetRecent(id: string) { if (recents.some((r) => r.id === id)) save(recents.filter((r) => r.id !== id)); }
export function clearRecents() { if (recents.length) save([]); }

// A rename gives a project a new id (it comes from where the file is): keep it listed.
export function renameRecents(idMap: Record<string, string>) {
  if (!recents.some((r) => r.id in idMap)) return;
  save(recents.map((r) => (r.id in idMap ? { ...r, id: idMap[r.id] } : r)));
}

export function getRecents(): Recent[] { return recents; }

export function useRecents(): Recent[] {
  const [r, setR] = useState(recents);
  useEffect(() => { subs.add(setR); return () => { subs.delete(setR); }; }, []);
  return r;
}

// How long ago, in as few letters as will do: "Just now", "5 min", "3 h", "Yesterday", "4 days", "12 Mar".
export function openedAgo(at: number, now = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min`;
  const d = new Date(at), today = new Date(now);
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return `${Math.floor(min / 60)} h`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// The same, as a sentence end: "opened 5 min ago", "opened yesterday", "opened 12 Mar".
export function openedWhen(at: number, now = Date.now()): string {
  const a = openedAgo(at, now);
  return a === "Just now" ? "opened just now" : a === "Yesterday" ? "opened yesterday"
    : /(min| h|days)$/.test(a) ? `opened ${a} ago` : `opened ${a}`;
}

// Test-only: start from a clean list.
export function _resetRecents(list: Recent[] = []) { recents = list; }
