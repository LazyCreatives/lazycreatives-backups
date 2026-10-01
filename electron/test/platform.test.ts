import { afterEach, describe, expect, it } from "vitest";
import { currentOs, osWords } from "../src/platform";

describe("platform words", () => {
  afterEach(() => { delete (globalThis as any).window; });

  it("reads the platform from the desktop bridge", () => {
    (globalThis as any).window = { ablebackup: { platform: "win32" } };
    expect(currentOs()).toBe("windows");
    (globalThis as any).window = { ablebackup: { platform: "darwin" } };
    expect(currentOs()).toBe("mac");
    (globalThis as any).window = { ablebackup: { platform: "linux" } };
    expect(currentOs()).toBe("linux");
  });

  it("never says Mac or Finder off a Mac", () => {
    for (const os of ["windows", "linux"] as const) {
      const w = osWords(os);
      expect(w.computer).not.toMatch(/mac/i);
      expect(w.fileManager).not.toMatch(/finder/i);
      expect(w.tray).not.toMatch(/menu bar/i);
    }
    expect(osWords("mac").computer).toBe("Mac");
  });
});
