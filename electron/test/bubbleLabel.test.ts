import { describe, expect, it } from "vitest";
import { bubbleLabel } from "../src/bubbleLabel";

describe("bubbleLabel", () => {
  it("shows a short name whole on one line", () => {
    expect(bubbleLabel("Sunset", 30)).toEqual(["Sunset"]);
  });
  it("splits a longer name over two lines between words instead of cutting it", () => {
    expect(bubbleLabel("freakin out loud", 34)).toEqual(["freakin", "out loud"]);
  });
  it("only adds … when two lines still can't hold it", () => {
    const lines = bubbleLabel("freakin out loud at the disco again tonight", 32);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
  it("leaves tiny bubbles unlabelled", () => {
    expect(bubbleLabel("Sunset", 10)).toEqual([]);
  });
});

describe("bubbleLabel words", () => {
  it("never chops a single word across two lines", () => {
    const lines = bubbleLabel("Moonrise", 22);
    expect(lines).toHaveLength(1);
  });
});
