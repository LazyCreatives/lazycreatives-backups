import { flushSync } from "react-dom";

// A soft cross-fade when the whole app changes how it looks (Crate / Sleeve, light /
// dark), instead of an instant cut. Uses the browser's own view transitions: a picture
// of the old app fades into the new one (timing in theme.css, on the shared motion
// tokens). With Reduce Motion on, or where view transitions don't exist, it's the
// plain instant switch.

type VT = { finished: Promise<void> };
const start = (): ((cb: () => void) => VT) | null => {
  const d = document as unknown as { startViewTransition?: (cb: () => void) => VT };
  return typeof d.startViewTransition === "function" ? d.startViewTransition.bind(document) : null;
};
const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Run a change (switching the look) inside the fade. flushSync makes React draw the
// new look inside the transition, so the "after" picture is the new look.
export function fadeSwitch(change: () => void): void {
  const go = start();
  if (!go || still()) { change(); return; }
  go(() => { flushSync(change); });
}

// Light / dark can be switched from places this app doesn't own (the shared picker, the
// computer itself at sunset), so watch <html> for it: put the old theme back for one
// moment, then switch inside the fade.
export function fadeThemeChanges(): void {
  if (typeof MutationObserver === "undefined") return;
  const root = document.documentElement;
  let busy = false;
  new MutationObserver((records) => {
    if (busy) return;
    const r = records.find((x) => x.attributeName === "data-theme");
    const was = r?.oldValue, now = root.dataset.theme;
    const go = start();
    if (!r || !was || !now || was === now || !go || still()) return;
    busy = true;
    root.dataset.theme = was;
    go(() => { root.dataset.theme = now; }).finished.finally(() => { busy = false; });
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"], attributeOldValue: true });
}
