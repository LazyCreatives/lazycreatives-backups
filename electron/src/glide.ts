import { useLayoutEffect, useRef, type RefObject } from "react";

// Things that change place glide there instead of jumping (FLIP: note where each one
// is, let the page change, then slide each from its old place to its new one). Only
// transform moves. Skipped when the computer asks for less motion.
// Same feel as the album songs' glide (useGlide in components/Albums.tsx): --dur-slow, --ease-glide.
const GLIDE_MS = 400;
const GLIDE = "cubic-bezier(0.16, 1, 0.3, 1)";
export const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Call the returned `note()` right before the change (a card leaving, a list re-sorting);
// on the next render every element under `root` with data-flip="<key>" that moved
// glides from where it was. Elements that are new or didn't move stay put.
export function useFlip(root: RefObject<HTMLElement | null>): () => void {
  const before = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const was = before.current;
    if (!was) return;
    before.current = null;
    if (reducedMotion()) return;
    root.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const r0 = was.get(el.dataset.flip ?? "");
      if (!r0) return;
      const r = el.getBoundingClientRect();
      const dx = r0.left - r.left, dy = r0.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: GLIDE_MS, easing: GLIDE });
    });
  });
  return () => {
    const m = new Map<string, DOMRect>();
    root.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => m.set(el.dataset.flip ?? "", el.getBoundingClientRect()));
    before.current = m;
  };
}

// One element that moved to another scrolling row (a stem dropped on another group):
// its rows clip whatever is outside them, so a stand-in copy glides above the page from
// the old place to the new one while the real one waits hidden underneath.
export function glideAcross(el: HTMLElement, from: DOMRect, layer: HTMLElement) {
  if (reducedMotion() || typeof el.animate !== "function") return;
  const to = el.getBoundingClientRect();
  const dx = from.left - to.left, dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  const box = layer.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  // a picture only: no ids, hooks or focus (the page's own lookups must keep finding the real one)
  for (const n of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
    for (const a of [...n.attributes]) if (a.name === "id" || a.name.startsWith("data-") || a.name === "draggable") n.removeAttribute(a.name);
  }
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.classList.add("glide-ghost");
  // the group colour and look come from the new row, so the copy carries them along
  const g = getComputedStyle(el).getPropertyValue("--g");
  if (g) ghost.style.setProperty("--g", g);
  Object.assign(ghost.style, {
    position: "absolute", left: `${to.left - box.left + layer.scrollLeft}px`, top: `${to.top - box.top + layer.scrollTop}px`,
    width: `${to.width}px`, height: `${to.height}px`, margin: "0", pointerEvents: "none", zIndex: "5",
  });
  layer.appendChild(ghost);
  el.style.visibility = "hidden";
  const done = () => { ghost.remove(); el.style.visibility = ""; };
  const a = ghost.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: GLIDE_MS, easing: GLIDE });
  a.onfinish = done;
  a.oncancel = done;
}
