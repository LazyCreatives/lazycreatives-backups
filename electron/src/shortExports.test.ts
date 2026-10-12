// Settings > "Hide short exports": what counts as short, and how the setting is kept.
import { beforeEach, describe, expect, it } from "vitest";
import { SHORT_EXPORTS_KEY, isShortExport, setShortExportSeconds, shortExportSeconds } from "./exportFolders";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
});

describe("short exports", () => {
  it("hides only songs whose length is known and under the minimum", () => {
    expect(isShortExport(8, 30)).toBe(true);
    expect(isShortExport(30, 30)).toBe(false);
    expect(isShortExport(null, 30)).toBe(false);     // length not known: never hidden
    expect(isShortExport(undefined, 30)).toBe(false);
    expect(isShortExport(8, 0)).toBe(false);          // the setting is off
  });
  it("is on at 30 seconds until changed, and keeps what you set", () => {
    expect(shortExportSeconds()).toBe(30);
    setShortExportSeconds(0);
    expect(shortExportSeconds()).toBe(0);
    setShortExportSeconds(45.4);
    expect(shortExportSeconds()).toBe(45);
    store.set(SHORT_EXPORTS_KEY, "\"lots\"");
    expect(shortExportSeconds()).toBe(30);
  });
});
