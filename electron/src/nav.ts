import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Back and forward through the pages you've visited, like a web browser.
// The side buttons on a mouse, Alt+Left/Right (Cmd+[ / Cmd+] on a Mac) and the
// keyboard's Back/Forward keys all move through it. Every stop remembers how far
// down the page was scrolled, so going back lands where you left off, with the
// row you opened briefly lit up. Kept the same in Backups and Uploader.

export interface Place {
  tab: string;
  sub?: string | null;   // an open project / crate / track on that tab
  flow?: string | null;  // a step-by-step flow covering the tabs
}

export function samePlace(a: Place, b: Place): boolean {
  return a.tab === b.tab && (a.sub ?? null) === (b.sub ?? null) && (a.flow ?? null) === (b.flow ?? null);
}

const MAX_STOPS = 50;

export interface Arrival<P extends Place> { place: P; scroll: number; from: P }

// The list of stops itself, with no React or page in it (easy to test).
export class NavHistory<P extends Place> {
  entries: { place: P; scroll: number }[];
  index = 0;
  constructor(start: P) { this.entries = [{ place: start, scroll: 0 }]; }

  get place(): P { return this.entries[this.index].place; }
  get canBack(): boolean { return this.index > 0; }
  get canForward(): boolean { return this.index < this.entries.length - 1; }
  get prev(): P | null { return this.canBack ? this.entries[this.index - 1].place : null; }

  // Go somewhere new: drops anything ahead (as a browser does). `replace` swaps
  // the current stop instead, for steps inside one flow. `startAt` is where the new
  // page starts scrolled (the same spot for a panel over the list). False when already there.
  go(place: P, scroll: number, replace = false, startAt = 0): boolean {
    if (samePlace(place, this.place)) return false;
    this.entries[this.index].scroll = scroll;
    if (replace) { this.entries[this.index] = { place, scroll: startAt }; return true; }
    this.entries.splice(this.index + 1);
    this.entries.push({ place, scroll: startAt });
    if (this.entries.length > MAX_STOPS) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }

  private move(by: 1 | -1, scroll: number): Arrival<P> | null {
    const next = this.index + by;
    if (next < 0 || next >= this.entries.length) return null;  // nothing there: do nothing
    const from = this.place;
    this.entries[this.index].scroll = scroll;
    this.index = next;
    return { place: this.place, scroll: this.entries[next].scroll, from };
  }
  back(scroll: number) { return this.move(-1, scroll); }
  forward(scroll: number) { return this.move(1, scroll); }
}

// The part of the window that scrolls.
const scroller = () => document.querySelector<HTMLElement>(".main");
const scrollNow = () => scroller()?.scrollTop ?? 0;

// Put the page back where it was. Lists load a moment after the page opens, so keep
// trying until the page is tall enough (or two seconds pass), and stop the moment
// the user scrolls or clicks themselves. Then make sure the row they came from is
// in view and light it up briefly.
function restoreScroll(target: number, cameFrom: string | null): () => void {
  const el = scroller();
  if (!el) return () => {};
  if (target <= 0 && !cameFrom) { el.scrollTop = 0; return () => {}; }
  let stopped = false, raf = 0;
  const t0 = performance.now();
  const stop = () => { stopped = true; };
  const userEvents = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  userEvents.forEach((ev) => el.addEventListener(ev, stop, { passive: true }));
  const cleanup = () => {
    stopped = true; cancelAnimationFrame(raf);
    userEvents.forEach((ev) => el.removeEventListener(ev, stop));
  };
  const step = () => {
    if (stopped) return cleanup();
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.min(target, Math.max(0, max));
    const row = cameFrom ? el.querySelector<HTMLElement>(`[data-nav-key="${CSS.escape(cameFrom)}"]`) : null;
    // (a page with no matching row waits only briefly for one)
    const ready = max >= target && (!cameFrom || row || performance.now() - t0 > 400);
    if (ready || performance.now() - t0 > 2000) {
      if (row) {
        const r = row.getBoundingClientRect(), box = el.getBoundingClientRect();
        if (r.top < box.top || r.bottom > box.bottom) row.scrollIntoView({ block: "center" });
        row.classList.remove("nav-came-from");
        void row.offsetWidth;  // restart the glow if it is already showing
        row.classList.add("nav-came-from");
        window.setTimeout(() => row.classList.remove("nav-came-from"), 2000);
      }
      return cleanup();
    }
    raf = requestAnimationFrame(step);
  };
  step();
  return cleanup;
}

export interface Nav<P extends Place> {
  place: P;
  prev: P | null;
  canBack: boolean;
  canForward: boolean;
  // overlay: the new place is a panel over the current page, so leave the page's scroll alone
  go: (place: P, opts?: { replace?: boolean; overlay?: boolean }) => void;
  back: () => void;
  forward: () => void;
}

export function useNav<P extends Place>(start: P): Nav<P> {
  const h = useRef<NavHistory<P>>();
  if (!h.current) h.current = new NavHistory(start);
  const hist = h.current;
  const [version, setVersion] = useState(0);
  const pending = useRef<{ scroll: number; cameFrom: string | null } | null>(null);

  const go = useCallback((place: P, opts?: { replace?: boolean; overlay?: boolean }) => {
    const now = scrollNow();
    if (hist.go(place, now, opts?.replace, opts?.overlay ? now : 0)) {
      pending.current = opts?.overlay ? null : { scroll: 0, cameFrom: null };
      setVersion((v) => v + 1);
    }
  }, [hist]);
  const arrive = useCallback((a: Arrival<P> | null) => {
    if (!a) return;
    pending.current = { scroll: a.scroll, cameFrom: a.from.sub ?? null };
    setVersion((v) => v + 1);
  }, []);
  const back = useCallback(() => arrive(hist.back(scrollNow())), [hist, arrive]);
  const forward = useCallback(() => arrive(hist.forward(scrollNow())), [hist, arrive]);

  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    return restoreScroll(p.scroll, p.cameFrom);
  }, [version]);

  return { place: hist.place, prev: hist.prev, canBack: hist.canBack, canForward: hist.canForward, go, back, forward };
}

// ── the buttons and keys ──

export type NavDir = "back" | "forward";

// Which way a key press goes, or null. Plain arrows are left alone (lists and the
// record stack use them); only the browser-style shortcuts count.
export function keyDir(e: Pick<KeyboardEvent, "key" | "code" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey">, isMac: boolean): NavDir | null {
  if (e.key === "BrowserBack") return "back";
  if (e.key === "BrowserForward") return "forward";
  if (e.shiftKey || e.ctrlKey) return null;
  if (isMac) {
    if (!e.metaKey || e.altKey) return null;
    if (e.key === "[" || e.code === "BracketLeft" || e.key === "ArrowLeft") return "back";
    if (e.key === "]" || e.code === "BracketRight" || e.key === "ArrowRight") return "forward";
    return null;
  }
  if (!e.altKey || e.metaKey) return null;
  if (e.key === "ArrowLeft") return "back";
  if (e.key === "ArrowRight") return "forward";
  return null;
}

// Typing in a box: arrows and shortcuts belong to the text, not to navigation.
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "file", "color", "image"].includes(type);
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

export function useBackForwardInput(back: () => void, forward: () => void) {
  useEffect(() => {
    // One press can reach the page twice on Windows (as a mouse button and as the
    // window's own back command); a repeat from the other route straight after is dropped.
    let last = { dir: "", src: "", at: 0 };
    const fire = (dir: NavDir, src: string) => {
      const now = Date.now();
      if (last.dir === dir && last.src !== src && now - last.at < 400) return;
      last = { dir, src, at: now };
      if (dir === "back") back(); else forward();
    };
    // Mouse buttons 3 and 4 are the side "back" and "forward" buttons.
    const onDown = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      fire(e.button === 3 ? "back" : "forward", "mouse");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return;
      const dir = keyDir(e, IS_MAC);
      if (!dir) return;
      e.preventDefault();
      fire(dir, "key");
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    const w = window as any;
    const off = (w.ablebackup || w.lazyupload)?.onNavCommand?.((dir: NavDir) => fire(dir, "window"));
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      if (typeof off === "function") off();
    };
  }, [back, forward]);
}
