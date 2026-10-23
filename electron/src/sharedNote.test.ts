import { describe, expect, it } from "vitest";
import { sharedNote } from "./sharedNote";

const now = 1_800_000_000_000;
const at = now / 1000;

describe("sharedNote", () => {
  it("asks for a backup drive first", () => {
    expect(sharedNote({ on: false, place: "" }, false, "Mac", now).text).toMatch(/backup drive above first/);
  });
  it("says it's off", () => {
    expect(sharedNote({ on: false, place: "/nas/x" }, true, "PC", now).text).toBe("Off. Albums and Folders stay on this PC only.");
  });
  it("names the other computers", () => {
    expect(sharedNote({ on: true, place: "x", at: at - 130, error: "", computers: ["STUDIO-PC"] }, true, "Mac", now).text)
      .toBe("Shared 2 minutes ago with STUDIO-PC.");
    const many = ["A", "B", "C", "D", "E"];
    expect(sharedNote({ on: true, place: "x", at, error: "", computers: many }, true, "Mac", now).text)
      .toBe("Shared just now with A, B and 3 more.");
  });
  it("says to switch it on elsewhere when it's alone", () => {
    expect(sharedNote({ on: true, place: "x", at, error: "", computers: [] }, true, "Mac", now).text).toMatch(/other computers too/);
  });
  it("waits quietly for an unplugged drive", () => {
    const n = sharedNote({ on: true, place: "x", at, error: "", waiting: "Your backup drive isn't connected right now." }, true, "Mac", now);
    expect(n.bad).toBeUndefined();
    expect(n.text).toMatch(/isn't connected/);
  });
  it("shows what's in the way", () => {
    const n = sharedNote({ on: true, place: "x", at, error: "Your backup place isn't connected right now." }, true, "Mac", now);
    expect(n.bad).toBe(true);
  });
});
