// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { announce, fresh, reached } from "./milestones";
import { onThisDay } from "./onThisDay";

describe("milestones", () => {
  beforeEach(() => localStorage.clear());
  it("reaches gold at 100, platinum at 500 and diamond at 1,000", () => {
    expect(reached(99)).toBeNull();
    expect(reached(100)?.tier).toBe("gold");
    expect(reached(260)?.at).toBe(250);
    expect(reached(500)?.tier).toBe("platinum");
    expect(reached(4000)?.tier).toBe("diamond");
  });
  it("announces only what's new, and only the highest when several are crossed at once", () => {
    expect(fresh(120, [])?.at).toBe(100);
    expect(fresh(120, [100])).toBeNull();
    expect(fresh(620, [])?.at).toBe(500);
    expect(fresh(300, [500])).toBeNull();  // counted down and back up: nothing new
  });
  it("says each line once", () => {
    expect(announce(50)).toBeNull();
    expect(announce(130)?.line).toBe("100 projects safe. That's gold.");
    expect(announce(130)).toBeNull();
    expect(announce(510)?.tier).toBe("platinum");
    expect(announce(510)).toBeNull();
  });
  it("stays quiet when the remembered list is unreadable", () => {
    localStorage.setItem("lc-milestones-seen", "not json");
    expect(announce(130)?.at).toBe(100);  // treated as nothing seen yet, then remembered
    expect(announce(130)).toBeNull();
  });
});

describe("on this day", () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 15, 0).getTime() / 1000;
  const now = new Date(2026, 9, 20, 9, 0);  // 20 Oct 2026
  it("finds a project last saved on this date in an earlier year, the oldest first", () => {
    const pick = onThisDay([
      { name: "Today", mtime: at(2026, 10, 20) },
      { name: "Night Drive v4", mtime: at(2023, 10, 20) },
      { name: "Older", mtime: at(2021, 10, 20) },
      { name: "Wrong day", mtime: at(2019, 10, 21) },
    ], now);
    expect(pick?.item.name).toBe("Older");
    expect(pick?.year).toBe(2021);
  });
  it("is null when nothing matches, or the library is empty", () => {
    expect(onThisDay([], now)).toBeNull();
    expect(onThisDay([{ name: "x", mtime: at(2024, 3, 1) }, { name: "y", mtime: 0 }], now)).toBeNull();
  });
  it("breaks a tie by name so the pick stays put", () => {
    expect(onThisDay([{ name: "b", mtime: at(2022, 10, 20) }, { name: "a", mtime: at(2022, 10, 20) }], now)?.item.name).toBe("a");
  });
});
