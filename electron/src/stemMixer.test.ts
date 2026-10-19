// The stem desk: which parts are heard with mute and solo on parts and groups,
// and how a fader reads in decibels.
import { describe, expect, it } from "vitest";
import { faderDb, partHeard } from "./stemMixer";

const none = { muted: [], soloed: [], groupMuted: [], groupSoloed: [] };

describe("mute and solo", () => {
  it("plays every part that isn't muted, on its own or with its group", () => {
    expect(partHeard("kick", "drums", none)).toBe(true);
    expect(partHeard("kick", "drums", { ...none, muted: ["kick"] })).toBe(false);
    expect(partHeard("kick", "drums", { ...none, groupMuted: ["drums"] })).toBe(false);
    expect(partHeard("bass", "bass", { ...none, groupMuted: ["drums"] })).toBe(true);
  });
  it("plays only soloed parts and soloed groups once anything is soloed", () => {
    expect(partHeard("kick", "drums", { ...none, soloed: ["sub"] })).toBe(false);
    expect(partHeard("kick", "drums", { ...none, groupSoloed: ["drums"] })).toBe(true);
    expect(partHeard("sub", "bass", { ...none, groupSoloed: ["drums"], soloed: ["sub"] })).toBe(true);
  });
  it("keeps a muted part quiet even inside a soloed group", () => {
    expect(partHeard("kick", "drums", { ...none, muted: ["kick"], groupSoloed: ["drums"] })).toBe(false);
  });
});

describe("faders in decibels", () => {
  it("reads like a desk", () => {
    expect(faderDb(1)).toBe("0.0");
    expect(faderDb(0.5)).toBe("−6.0");
    expect(faderDb(0)).toBe("−∞");
  });
});
