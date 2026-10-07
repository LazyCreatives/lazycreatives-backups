import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRecents, clearRecents, forgetRecent, getRecents, noteOpened, openedAgo, openedWhen, renameRecents } from "../src/recents";

// SHARED FILE: the same test lives in Backups and Uploader (electron/test/recents.test.ts).
const r = (id: string) => ({ id, name: `Song ${id}`, cover: `Song ${id}`, genre: "House" });

describe("recently opened", () => {
  let store: Record<string, string> = {};
  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
    _resetRecents();
  });

  it("puts the newest first and does not repeat one", () => {
    noteOpened(r("a"), 1_000); noteOpened(r("b"), 200_000); noteOpened(r("a"), 400_000);
    expect(getRecents().map((x) => x.id)).toEqual(["a", "b"]);
    expect(JSON.parse(store["lc-recents"])).toHaveLength(2);
  });

  it("keeps twelve at most", () => {
    for (let i = 0; i < 20; i++) noteOpened(r(String(i)), i * 100_000);
    expect(getRecents()).toHaveLength(12);
    expect(getRecents()[0].id).toBe("19");
  });

  it("removes one, clears all and follows a rename", () => {
    noteOpened(r("a"), 0); noteOpened(r("b"), 100_000);
    renameRecents({ a: "a2" });
    expect(getRecents().map((x) => x.id)).toEqual(["b", "a2"]);
    forgetRecent("b");
    expect(getRecents().map((x) => x.id)).toEqual(["a2"]);
    clearRecents();
    expect(getRecents()).toEqual([]);
  });

  it("says how long ago in few words", () => {
    const now = new Date(2026, 9, 6, 15, 0).getTime();
    expect(openedAgo(now - 20_000, now)).toBe("Just now");
    expect(openedAgo(now - 5 * 60_000, now)).toBe("5 min");
    expect(openedAgo(now - 3 * 3_600_000, now)).toBe("3 h");
    expect(openedAgo(new Date(2026, 9, 5, 23, 0).getTime(), now)).toBe("Yesterday");
    expect(openedAgo(new Date(2026, 9, 2, 12, 0).getTime(), now)).toBe("4 days");
    expect(openedWhen(now - 5 * 60_000, now)).toBe("opened 5 min ago");
    expect(openedWhen(new Date(2026, 9, 5, 23, 0).getTime(), now)).toBe("opened yesterday");
  });
});
