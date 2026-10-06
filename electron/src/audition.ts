import { useEffect, useState } from "react";
import { keep, recall } from "./desktop";

// Preview on hover: while it is on, pointing at a song (or moving onto it with the
// arrow keys) plays a few seconds from the middle, and moving away stops it. The
// switch is remembered; each app's Player does the playing (audition / endAudition).
// SHARED FILE: the same file lives in Backups and Uploader (electron/src/audition.ts).

const KEY = "lc-audition";
let on = recall<boolean>(KEY, false, (v) => typeof v === "boolean");
const subs = new Set<(v: boolean) => void>();

export function auditionOn() { return on; }

export function setAudition(v: boolean) {
  on = v;
  keep(KEY, v);
  subs.forEach((f) => f(v));
}

export function useAuditionMode(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(on);
  useEffect(() => { subs.add(setV); return () => { subs.delete(setV); }; }, []);
  return [v, setAudition];
}

// Up and Down move between songs while previewing is on, so a list can be played
// through from the keyboard. Only rows marked data-audition take part.
let keysBound = false;
export function bindAuditionKeys() {
  if (keysBound || typeof document === "undefined") return;
  keysBound = true;
  document.addEventListener("keydown", (e) => {
    if (!on || (e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.altKey || e.metaKey || e.ctrlKey) return;
    const here = document.activeElement as HTMLElement | null;
    if (!here?.hasAttribute("data-audition")) return;
    const all = [...document.querySelectorAll<HTMLElement>("[data-audition]")];
    const next = all[all.indexOf(here) + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest" });
  });
}

// How long the pointer has to rest on a song before it plays, so sweeping across a
// list doesn't fire off a string of starts.
export const AUDITION_DELAY = 280;
// Where in the song the preview starts: about a third in, past most intros.
export const AUDITION_FROM = 0.33;
