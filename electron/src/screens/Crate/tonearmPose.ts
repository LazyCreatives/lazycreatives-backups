// Where the tonearm sits for each look, in px from the centre of the record on deck.
export const ARM_LENGTH = 190;   // pivot to needle tip

export interface Deck {
  disc: { x: number; y: number; r: number; label: number }; // the record you can see
  needle: { x: number; y: number };                         // where the needle lands
}

// Measured off the rendered Dig: Crate shows the whole record; Sleeve shows the cover
// with the record slid out to the right, so the needle lands on the bit that shows.
export const DECKS: Record<"crate" | "sleeve", Deck> = {
  crate: { disc: { x: 0, y: 0, r: 141, label: 60 }, needle: { x: 95, y: 30 } },
  sleeve: { disc: { x: 82, y: 0, r: 125, label: 19 }, needle: { x: 160, y: 8 } },
};

export interface Pose { pivot: { x: number; y: number }; play: number; rest: { x: number; y: number } }

// The pivot sits up and to the right of the needle, so the arm comes in from the
// corner like a real deck's. `play` is how far (degrees, clockwise) it swings from
// hanging straight down (parked, off the record) to the needle on the groove.
const SWING = { x: 0.48, y: -0.877 };  // unit vector from needle to pivot, about 29° off vertical

export function tonearmPose(look: "crate" | "sleeve"): Pose {
  const { needle } = DECKS[look];
  const pivot = { x: Math.round(needle.x + SWING.x * ARM_LENGTH), y: Math.round(needle.y + SWING.y * ARM_LENGTH) };
  const play = (Math.asin((pivot.x - needle.x) / ARM_LENGTH) * 180) / Math.PI;
  return { pivot, play, rest: { x: pivot.x, y: pivot.y + ARM_LENGTH } };
}
