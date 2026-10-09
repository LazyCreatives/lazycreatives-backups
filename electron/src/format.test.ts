import { describe, expect, it } from "vitest";
import { fmtInterval, fmtNext } from "./format";

describe("how often automatic backups run", () => {
  it("reads like a person would say it", () => {
    expect(fmtInterval(0)).toBe("off");
    expect(fmtInterval(60)).toBe("every hour");
    expect(fmtInterval(360)).toBe("every 6 hours");
    expect(fmtInterval(1440)).toBe("once a day");
    expect(fmtInterval(2880)).toBe("every 2 days");
    expect(fmtInterval(10080)).toBe("once a week");
    expect(fmtInterval(30)).toBe("every 30 min");
  });
});

describe("when the next backup runs", () => {
  const now = new Date(2026, 9, 9, 22, 0);
  it("says today or tomorrow when it's soon", () => {
    expect(fmtNext(new Date(2026, 9, 9, 23, 30).toISOString(), now)).toMatch(/^today /);
    expect(fmtNext(new Date(2026, 9, 10, 8, 40).toISOString(), now)).toMatch(/^tomorrow /);
    expect(fmtNext(new Date(2026, 9, 14, 8, 40).toISOString(), now)).not.toMatch(/^(today|tomorrow)/);
    expect(fmtNext(null, now)).toBe("—");
  });
});
