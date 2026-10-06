import { useEffect, useRef, useState } from "react";
import { getLook, setLook } from "./look";
import { IS_MAC } from "./desktop";

// The narrow window, the page side. SHARED FILE: the same file lives in Backups and
// Uploader (electron/src/companion.ts); change both together. The window itself is
// made by electron/companion.js; it loads this same page with #companion.

const bridge = () => (window as any).ablebackup || (window as any).lazyupload;

// Is this page the narrow window?
export const IS_COMPANION = typeof location !== "undefined" && location.hash === "#companion";

// The shortcut, in words, for buttons and the find-anything list.
export const COMPANION_KEYS = IS_MAC ? "Cmd + Shift + N" : "Ctrl + Shift + N";

export function openCompanion() { bridge()?.openCompanion?.(); }
export function closeCompanion() { bridge()?.closeCompanion?.(); }

// What the main window is asked to show when the narrow window hands over to it.
export type CompanionCommand =
  | { go: "home" }
  | { go: "project"; name: string }
  | { go: "upload"; paths?: string[] };

// Bring the main window forward, showing what was asked for.
export function showMain(cmd: CompanionCommand = { go: "home" }) { bridge()?.showMain?.(cmd); }

// In the main window: run what the narrow window asks for.
export function useCompanionCommand(run: (cmd: CompanionCommand) => void) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const off = bridge()?.onCompanionCommand?.((cmd: CompanionCommand) => latest.current(cmd));
    return () => { if (typeof off === "function") off(); };
  }, []);
}

// The pin: keeps the narrow window above your music program. On unless turned off.
export function usePinned(): [boolean, () => void] {
  const [pinned, setPinned] = useState(true);
  useEffect(() => {
    bridge()?.companionPinned?.().then((p: boolean) => setPinned(p !== false)).catch(() => {});
  }, []);
  const toggle = () => {
    const next = !pinned;
    setPinned(next);
    bridge()?.setCompanionPinned?.(next)?.then?.((p: boolean) => setPinned(!!p)).catch?.(() => {});
  };
  return [pinned, toggle];
}

// The look picked in the main window follows into the narrow window straight away
// (both windows share the same saved settings; another window's change arrives as
// a storage event).
export function useLookFromOtherWindows() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "lc-look") setLook(getLook());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}

// Re-run `tick` every `ms` while the window is showing, and when it comes back.
export function useGentlePoll(tick: () => void, ms: number) {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState !== "hidden") latest.current(); }, ms);
    const back = () => { if (document.visibilityState === "visible") latest.current(); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [ms]);
}

// "Just now", "4 min ago", "2 h ago", "Yesterday", "3 days ago", then the date: short
// enough for a narrow column. `then` and `now` are milliseconds.
export function ago(then: number | null | undefined, now: number = Date.now()): string {
  if (!then || !Number.isFinite(then)) return "Never";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "Just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const a = new Date(then), b = new Date(now);
  const sameDay = a.toDateString() === b.toDateString();
  const hours = Math.floor(mins / 60);
  if (sameDay || hours < 6) return `${hours} h ago`;
  const y = new Date(b); y.setDate(b.getDate() - 1);
  if (a.toDateString() === y.toDateString()) return "Yesterday";
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(b) - midnight(a)) / 86400000);
  if (days < 7) return `${days} days ago`;
  return a.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(a.getFullYear() === b.getFullYear() ? {} : { year: "numeric" }) });
}
