// Keyboard helpers shared by both apps (keep this file identical in Backups and Uploader).
import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

// Enter/Space on a clickable row or card opens it, but only when the row itself has
// focus: keys pressed on a button inside the row (tick, pin, Back up, ···) stay with
// that button.
export function rowKey(open: () => void) {
  return (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// While a pop-up is open: Tab and Shift+Tab stay inside it, focus moves in when it
// opens (unless something inside already has it), and goes back to where it was
// when it closes, so a keyboard user keeps their place in a long list.
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open = true) {
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) {
      const first = box.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? box).focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const inside = ref.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
