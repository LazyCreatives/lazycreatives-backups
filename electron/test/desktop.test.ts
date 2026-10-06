import { describe, expect, it } from "vitest";
// Shared by Backups and Uploader, like desktop.ts itself.
import { baseName, folderOf, isInside, keep, pageNumber, recall, shortcutFor } from "../src/desktop";
// desktop.js is the main-process side (CommonJS); only its pure screen check is used here.
// @ts-ignore - untyped JS module imported for its runtime behaviour
import * as desktopMain from "../electron/desktop";

const { onAScreen, windowChromeOptions, windowMaterial } = desktopMain as any;

const press = (k: Record<string, unknown>) => ({
  key: "", code: "", altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, target: null, ...k,
}) as any;
const button = { tagName: "BUTTON", closest: (sel: string) => (sel.includes("button") ? {} : null) };
const textBox = { tagName: "INPUT", type: "search", closest: () => ({}) };
const page = { tagName: "DIV", closest: () => null };

describe("keyboard shortcuts", () => {
  it("Cmd+2 on a Mac and Ctrl+2 elsewhere open the second sidebar page", () => {
    expect(shortcutFor(press({ key: "2", code: "Digit2", metaKey: true }), true)).toBe("page-2");
    expect(shortcutFor(press({ key: "2", code: "Digit2", ctrlKey: true }), false)).toBe("page-2");
    expect(shortcutFor(press({ key: "2", code: "Digit2" }), false)).toBe(null);
    expect(pageNumber("page-2")).toBe(2);
    expect(pageNumber("find")).toBe(null);
  });
  it("Cmd+F on a Mac and Ctrl+F elsewhere jump to search", () => {
    expect(shortcutFor(press({ key: "f", metaKey: true }), true)).toBe("find");
    expect(shortcutFor(press({ key: "f", ctrlKey: true }), false)).toBe("find");
    expect(shortcutFor(press({ key: "f", ctrlKey: true }), true)).toBe(null);   // Ctrl+F on a Mac is not it
    expect(shortcutFor(press({ key: "f", metaKey: true }), false)).toBe(null);
  });

  it("Cmd/Ctrl + comma opens Settings, even while typing", () => {
    expect(shortcutFor(press({ key: ",", metaKey: true, target: textBox }), true)).toBe("settings");
    expect(shortcutFor(press({ key: ",", ctrlKey: true }), false)).toBe("settings");
    expect(shortcutFor(press({ key: ",", ctrlKey: true, shiftKey: true }), false)).toBe(null);
  });

  it("Space plays or pauses, but not in a box or on a button", () => {
    expect(shortcutFor(press({ key: " ", code: "Space", target: page }), true)).toBe("play");
    expect(shortcutFor(press({ key: " ", code: "Space", target: textBox }), true)).toBe(null);
    expect(shortcutFor(press({ key: " ", code: "Space", target: button }), false)).toBe(null);
    expect(shortcutFor(press({ key: " ", code: "Space", shiftKey: true, target: page }), false)).toBe(null);
  });

  it("leaves every other key alone", () => {
    expect(shortcutFor(press({ key: "a", target: page }), true)).toBe(null);
    expect(shortcutFor(press({ key: "Escape", target: page }), false)).toBe(null);
  });
});

describe("remembered between launches", () => {
  it("reads back what was kept, and falls back when it is missing or no longer fits", () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    expect(recall("lc-test", "home")).toBe("home");
    keep("lc-test", "library");
    expect(recall("lc-test", "home")).toBe("library");
    expect(recall("lc-test", "home", (v) => v === "dig")).toBe("home");
    store.set("lc-test", "{not json");
    expect(recall("lc-test", "home")).toBe("home");
    delete (globalThis as any).localStorage;
    expect(recall("lc-test", "home")).toBe("home");   // storage switched off: still works
    expect(() => keep("lc-test", "x")).not.toThrow();
  });
});

describe("dropped paths", () => {
  it("finds the folder and the name of a dropped file on any computer", () => {
    expect(folderOf("/Users/rob/Music/Freaky 2.als")).toBe("/Users/rob/Music");
    expect(folderOf("C:\\Users\\rob\\Mixes\\mix.wav")).toBe("C:\\Users\\rob\\Mixes");
    expect(baseName("/Users/rob/Music/Projects/")).toBe("Projects");
    expect(baseName("C:\\Mixes")).toBe("Mixes");
  });
  it("knows a folder that is already covered by one you have", () => {
    expect(isInside("/Users/rob/Music/Freaky 2 Project", ["/Users/rob/Music"])).toBe(true);
    expect(isInside("/Users/rob/Music/", ["/Users/rob/Music"])).toBe(true);
    expect(isInside("/Users/rob/Musical", ["/Users/rob/Music"])).toBe(false);
    expect(isInside("D:\\Mixes\\Old", ["D:\\Mixes"])).toBe(true);
  });
});

describe("window place", () => {
  const laptop = [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }];
  it("keeps a window that is on a screen", () => {
    expect(onAScreen({ x: 100, y: 80, width: 1100, height: 760 }, laptop)).toBe(true);
  });
  it("drops a place on a screen that has gone (an unplugged monitor)", () => {
    expect(onAScreen({ x: 2000, y: 100, width: 1100, height: 760 }, laptop)).toBe(false);
    expect(onAScreen({ x: 1400, y: 100, width: 1100, height: 760 }, laptop)).toBe(false);
  });
  it("is fine with a window that hangs a little off the edge", () => {
    expect(onAScreen({ x: 900, y: 100, width: 1100, height: 760 }, laptop)).toBe(true);
  });
});

describe("window frame", () => {
  it("Windows gets the app's own dark strip with Windows' buttons drawn over it", () => {
    const o = windowChromeOptions("win32", "none");
    expect(o.titleBarStyle).toBe("hidden");
    expect(o.titleBarOverlay).toMatchObject({ color: "#0B0E12", height: 36 });
    expect(o.backgroundColor).toBe("#0B0E12");
  });
  it("Linux keeps its usual frame on solid ink", () => {
    expect(windowChromeOptions("linux", "none")).toEqual({ backgroundColor: "#0B0E12" });
  });
  it("in light mode the window and the Windows strip are paper, with dark buttons", () => {
    const o = windowChromeOptions("win32", "none", "light");
    expect(o.backgroundColor).toBe("#EDEAE4");
    expect(o.titleBarOverlay).toMatchObject({ color: "#EDEAE4", symbolColor: "#3A424C" });
    expect(windowChromeOptions("win32", "mica", "light").titleBarOverlay).toMatchObject({ color: "#00000000", symbolColor: "#3A424C" });
  });
});

describe("window glass", () => {
  it("picks frosted glass on a Mac, Mica on Windows 11, nothing elsewhere", () => {
    expect(windowMaterial("darwin", "25.0.0")).toBe("vibrancy");
    expect(windowMaterial("win32", "10.0.22631")).toBe("mica");
    expect(windowMaterial("win32", "10.0.19045")).toBe("none");
    expect(windowMaterial("linux", "6.8.0")).toBe("none");
  });
  it("Mica clears the window and the title strip so the wallpaper tint shows", () => {
    const o = windowChromeOptions("win32", "mica");
    expect(o.backgroundMaterial).toBe("mica");
    expect(o.backgroundColor).toBe("#00000000");
    expect(o.titleBarOverlay).toMatchObject({ color: "#00000000", symbolColor: "#AAB4C0" });
  });
  it("a Mac gets the sidebar material and keeps its usual frame", () => {
    const o = windowChromeOptions("darwin", "vibrancy");
    expect(o).toMatchObject({ vibrancy: "sidebar", backgroundColor: "#00000000" });
    expect(o.titleBarStyle).toBeUndefined();
  });
});

describe("right-click in text", () => {
  const { textMenuTemplate } = desktopMain as any;
  const roles = (items: any[]) => items.map((i) => i.role || i.type || i.label);
  it("a text box gets Cut, Copy, Paste and Select all", () => {
    const items = textMenuTemplate({ isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true } }, false);
    expect(roles(items)).toEqual(["cut", "copy", "paste", "separator", "selectAll"]);
  });
  it("a misspelt word offers fixes first", () => {
    const items = textMenuTemplate({ isEditable: true, misspelledWord: "tehcno", dictionarySuggestions: ["techno"], editFlags: {} }, false);
    expect(items[0]).toMatchObject({ label: "techno", replace: "techno" });
    expect(items[1]).toMatchObject({ label: "Add to dictionary", learn: "tehcno" });
  });
  it("selected words on a page can be copied, and looked up on a Mac", () => {
    expect(roles(textMenuTemplate({ isEditable: false, selectionText: "Midnight Drive" }, false))).toEqual(["copy"]);
    expect(textMenuTemplate({ isEditable: false, selectionText: "Midnight Drive" }, true).at(-1)).toMatchObject({ lookUp: true });
  });
  it("nothing selected and no text box: no menu", () => {
    expect(textMenuTemplate({ isEditable: false, selectionText: "  " }, true)).toEqual([]);
  });
});
