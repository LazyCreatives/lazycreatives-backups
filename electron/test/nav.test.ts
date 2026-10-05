import { describe, expect, it } from "vitest";
import { NavHistory, isTyping, keyDir, type Place } from "../src/nav";

const key = (k: Partial<KeyboardEvent>) => ({ key: "", code: "", altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...k });

describe("back/forward history", () => {
  it("goes back and forward like a browser, remembering how far down each page was", () => {
    const h = new NavHistory<Place>({ tab: "library" });
    expect(h.canBack).toBe(false);
    h.go({ tab: "library", sub: "p1" }, 640);
    expect(h.place).toEqual({ tab: "library", sub: "p1" });
    const back = h.back(0)!;
    expect(back.place).toEqual({ tab: "library" });
    expect(back.scroll).toBe(640);           // the list comes back where it was
    expect(back.from.sub).toBe("p1");        // and knows which row to light up
    const fwd = h.forward(640)!;
    expect(fwd.place.sub).toBe("p1");
  });

  it("does nothing when there is nowhere to go", () => {
    const h = new NavHistory<Place>({ tab: "home" });
    expect(h.back(0)).toBeNull();
    expect(h.forward(0)).toBeNull();
    expect(h.place).toEqual({ tab: "home" });
  });

  it("drops the forward pages when you go somewhere new", () => {
    const h = new NavHistory<Place>({ tab: "home" });
    h.go({ tab: "library" }, 0);
    h.go({ tab: "dig" }, 0);
    h.back(0);
    h.go({ tab: "settings" }, 0);
    expect(h.canForward).toBe(false);
    expect(h.back(0)!.place.tab).toBe("library");
  });

  it("ignores going to the page you're already on, and replaces steps inside a flow", () => {
    const h = new NavHistory<Place>({ tab: "home" });
    expect(h.go({ tab: "home" }, 0)).toBe(false);
    h.go({ tab: "home", flow: "scan" }, 0);
    h.go({ tab: "home", flow: "progress" }, 0, true);
    expect(h.entries.length).toBe(2);
    expect(h.back(0)!.place).toEqual({ tab: "home" });
  });

  it("keeps the list's spot for a panel opened over it", () => {
    const h = new NavHistory<Place>({ tab: "manage" });
    h.go({ tab: "manage", sub: "7" }, 900, false, 900);
    expect(h.entries[1].scroll).toBe(900);
  });

  it("keeps at most 50 stops", () => {
    const h = new NavHistory<Place>({ tab: "home" });
    for (let i = 0; i < 80; i++) h.go({ tab: "library", sub: String(i) }, 0);
    expect(h.entries.length).toBe(50);
    expect(h.place.sub).toBe("79");
  });
});

describe("back/forward keys", () => {
  it("uses Alt+arrows on Windows and Linux", () => {
    expect(keyDir(key({ key: "ArrowLeft", altKey: true }), false)).toBe("back");
    expect(keyDir(key({ key: "ArrowRight", altKey: true }), false)).toBe("forward");
    expect(keyDir(key({ key: "ArrowLeft" }), false)).toBeNull();
    expect(keyDir(key({ key: "ArrowLeft", altKey: true, shiftKey: true }), false)).toBeNull();
  });
  it("uses Cmd+[ / Cmd+] and Cmd+arrows on a Mac", () => {
    expect(keyDir(key({ key: "[", code: "BracketLeft", metaKey: true }), true)).toBe("back");
    expect(keyDir(key({ key: "]", code: "BracketRight", metaKey: true }), true)).toBe("forward");
    expect(keyDir(key({ key: "ArrowLeft", metaKey: true }), true)).toBe("back");
    expect(keyDir(key({ key: "ArrowLeft", altKey: true }), true)).toBeNull();
  });
  it("understands the keyboard's own Back and Forward keys", () => {
    expect(keyDir(key({ key: "BrowserBack" }), false)).toBe("back");
    expect(keyDir(key({ key: "BrowserForward" }), true)).toBe("forward");
  });
  it("leaves keys alone while typing", () => {
    const el = (tagName: string, extra: object = {}) => ({ tagName, ...extra }) as unknown as EventTarget;
    expect(isTyping(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTyping(el("TEXTAREA"))).toBe(true);
    expect(isTyping(el("SELECT"))).toBe(true);
    expect(isTyping(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTyping(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTyping(el("BUTTON"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
