import { describe, expect, it } from "vitest";
import { ARM_LENGTH, DECKS, tonearmPose } from "../src/screens/Crate/tonearmPose";

// Where the needle ends up after swinging `deg` clockwise from hanging straight down.
function tipAt(pivot: { x: number; y: number }, deg: number) {
  const r = (deg * Math.PI) / 180;
  return { x: pivot.x - ARM_LENGTH * Math.sin(r), y: pivot.y + ARM_LENGTH * Math.cos(r) };
}

describe("tonearmPose", () => {
  for (const look of ["crate", "sleeve"] as const) {
    const { disc } = DECKS[look];
    const fromCentre = (p: { x: number; y: number }) => Math.hypot(p.x - disc.x, p.y - disc.y);

    it(`${look}: playing, the needle sits on the grooves (not the label, not off the edge)`, () => {
      const pose = tonearmPose(look);
      const d = fromCentre(tipAt(pose.pivot, pose.play));
      expect(d).toBeGreaterThan(disc.label + 10);
      expect(d).toBeLessThan(disc.r - 10);
    });

    it(`${look}: parked, the needle is clear of the record`, () => {
      const pose = tonearmPose(look);
      expect(fromCentre(tipAt(pose.pivot, 0))).toBeGreaterThan(disc.r + 20);
      expect(pose.rest).toEqual(tipAt(pose.pivot, 0));
    });

    it(`${look}: the arm swings in towards the record, a believable amount`, () => {
      const { play } = tonearmPose(look);
      expect(play).toBeGreaterThan(15);
      expect(play).toBeLessThan(45);
    });
  }
});
