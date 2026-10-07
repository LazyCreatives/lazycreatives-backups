import { describe, expect, it } from "vitest";
import { digKey } from "../src/screens/Crate/digKeys";

const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key: k, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false, ...extra });
const noPopup = { querySelector: () => null };
const popup = { querySelector: () => ({}) as Element };

// A stand-in element: its tag, and which selectors `closest` should match.
const el = (tagName: string, matches: string[] = [], type = "") =>
  ({ tagName, type, isContentEditable: false,
     closest: (sel: string) => (matches.some((m) => sel.includes(m)) ? {} : null) }) as unknown as HTMLElement;

describe("Dig page keys", () => {
  const crates = el("BUTTON", ["button"]);   // where focus lands on opening Dig

  it("flips records with the arrows even when focus is on the Crates button", () => {
    expect(digKey(key("ArrowLeft"), crates, noPopup)).toBe("prev");
    expect(digKey(key("ArrowRight"), crates, noPopup)).toBe("next");
    expect(digKey(key("Home"), crates, noPopup)).toBe("first");
    expect(digKey(key("End"), crates, noPopup)).toBe("last");
  });

  it("opens the record with Enter from the page, but lets Enter press a focused button", () => {
    expect(digKey(key("Enter"), el("BODY"), noPopup)).toBe("open");
    expect(digKey(key("Enter"), crates, noPopup)).toBeNull();
  });

  it("leaves the keys alone while typing, in a dropdown, on the song slider or with a pop-up open", () => {
    expect(digKey(key("ArrowRight"), el("INPUT", [], "text"), noPopup)).toBeNull();
    expect(digKey(key("ArrowRight"), el("SELECT"), noPopup)).toBeNull();
    expect(digKey(key("ArrowRight"), el("CANVAS", ['[role="slider"]']), noPopup)).toBeNull();
    expect(digKey(key("ArrowRight"), el("BODY"), popup)).toBeNull();
  });

  it("leaves Alt/Cmd/Ctrl arrows for back and forward, and ignores keys already handled", () => {
    expect(digKey(key("ArrowLeft", { altKey: true }), crates, noPopup)).toBeNull();
    expect(digKey(key("ArrowLeft", { metaKey: true }), crates, noPopup)).toBeNull();
    expect(digKey(key("ArrowLeft", { defaultPrevented: true }), crates, noPopup)).toBeNull();
    expect(digKey(key("a"), crates, noPopup)).toBeNull();
  });
});
