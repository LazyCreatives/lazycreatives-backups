import { describe, it, expect } from "vitest";
import { auditionOn, setAudition } from "../src/audition";

describe("preview on hover", () => {
  it("is off until switched on", () => {
    expect(auditionOn()).toBe(false);
    setAudition(true);
    expect(auditionOn()).toBe(true);
    setAudition(false);
  });
});
