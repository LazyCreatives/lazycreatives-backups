import { describe, it, expect } from "vitest";
// version.js is the updater's pure version check (CommonJS, no electron import).
// @ts-ignore - untyped JS module imported for its runtime behaviour
import * as version from "../electron/version";

const { isNewer } = version as any;

describe("updater version check", () => {
  it("spots a newer release", () => {
    expect(isNewer("0.1.6", "0.1.5")).toBe(true);
    expect(isNewer("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  });

  it("ignores the same or an older release", () => {
    expect(isNewer("0.1.5", "0.1.5")).toBe(false);
    expect(isNewer("v0.1.5", "0.1.5")).toBe(false);
    expect(isNewer("0.1.4", "0.1.5")).toBe(false);
    expect(isNewer("0.1.9", "0.1.10")).toBe(false);
  });
});
