import { isTyping } from "../../nav";

export type DigKeyAction = "prev" | "next" | "first" | "last" | "open";

// What a key press does on the Dig page, or null to leave it alone. The keys work
// wherever focus is on the page (opening Dig puts it on the Crates button), except
// while typing, inside something that uses arrows itself (a dropdown, the song
// slider, a menu), or with a pop-up such as Find anything or Now playing open.
export function digKey(
  e: Pick<KeyboardEvent, "key" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey" | "defaultPrevented">,
  target: EventTarget | null,
  doc: Pick<Document, "querySelector"> = document,
): DigKeyAction | null {
  if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return null;
  const action: DigKeyAction | null =
    e.key === "ArrowLeft" ? "prev" : e.key === "ArrowRight" ? "next"
    : e.key === "Home" ? "first" : e.key === "End" ? "last"
    : e.key === "Enter" ? "open" : null;
  if (!action) return null;
  if (isTyping(target)) return null;
  if (doc.querySelector('[aria-modal="true"]')) return null;
  const el = target as HTMLElement | null;
  if (el && typeof el.closest === "function") {
    if (el.closest('[role="slider"], [role="menu"], [role="menuitem"], [role="listbox"], [role="tablist"], [role="radiogroup"]')) return null;
    // Enter on a button or link presses that button, not "open the record".
    if (action === "open" && el.closest("button, a, input, [role='button']")) return null;
  }
  return action;
}
