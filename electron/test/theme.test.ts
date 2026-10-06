import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Shared by Backups and Uploader, like look.ts itself.

// A stand-in for the bits of the page look.ts touches: storage, <html>, the computer's
// dark/light setting and the window bridge.
function fakePage({ dark = true, stored = null as string | null } = {}) {
  const store = new Map<string, string>(stored == null ? [] : [["lc-theme", stored]]);
  const listeners: (() => void)[] = [];
  const query = { matches: dark, addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener() {} };
  const html = { dataset: {} as Record<string, string> };
  const setTheme = vi.fn();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  vi.stubGlobal("document", { documentElement: html, body: null, addEventListener() {}, querySelector: () => null });
  vi.stubGlobal("window", { matchMedia: () => query, ablebackup: { setTheme } });
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  return {
    store, html, setTheme,
    // the computer switches between dark and light
    flip(toDark: boolean) { query.matches = toDark; listeners.forEach((f) => f()); },
  };
}

async function freshLook() {
  vi.resetModules();
  return await import("../src/look");
}

describe("light or dark", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is dark until someone picks otherwise, so nothing changes for current users", async () => {
    const page = fakePage({ dark: false });
    const look = await freshLook();
    expect(look.getThemeChoice()).toBe("dark");
    expect(page.html.dataset.theme).toBe("dark");
  });

  it("reads back what was picked, and anything odd counts as dark", async () => {
    fakePage({ stored: "light" });
    let look = await freshLook();
    expect(look.getThemeChoice()).toBe("light");
    fakePage({ stored: "purple" });
    look = await freshLook();
    expect(look.getThemeChoice()).toBe("dark");
    expect(look.parseThemeChoice("system")).toBe("system");
  });

  it("Match my computer comes out as the computer's own setting", async () => {
    const look = await freshLook();
    expect(look.resolveTheme("system", true)).toBe("dark");
    expect(look.resolveTheme("system", false)).toBe("light");
    expect(look.resolveTheme("light", true)).toBe("light");
    expect(look.resolveTheme("dark", false)).toBe("dark");
  });

  it("picking light keeps it, marks <html> and tells the window", async () => {
    const page = fakePage();
    const look = await freshLook();
    look.setThemeChoice("light");
    expect(page.store.get("lc-theme")).toBe("light");
    expect(page.html.dataset.theme).toBe("light");
    expect(page.setTheme).toHaveBeenLastCalledWith("light", "light");
    expect(look.currentTheme()).toBe("light");
    look.toggleTheme();
    expect(page.html.dataset.theme).toBe("dark");
    expect(page.store.get("lc-theme")).toBe("dark");
  });

  it("Match my computer follows the computer when it switches", async () => {
    const page = fakePage({ dark: true, stored: "system" });
    await freshLook();
    expect(page.html.dataset.theme).toBe("dark");
    page.flip(false);
    expect(page.html.dataset.theme).toBe("light");
    expect(page.setTheme).toHaveBeenLastCalledWith("system", "light");
  });

  it("a fixed choice ignores the computer switching", async () => {
    const page = fakePage({ dark: true, stored: "dark" });
    await freshLook();
    page.flip(false);
    expect(page.html.dataset.theme).toBe("dark");
  });
});
