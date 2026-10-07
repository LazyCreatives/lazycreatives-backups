import { afterEach, describe, expect, it, vi } from "vitest";

// A pretend Web Audio: each listener reports whatever wave the test puts in `wave`.
function fakeAudio(state = "running") {
  const wave = { l: new Float32Array(1024), r: new Float32Array(1024) };
  const toSpeakers: unknown[] = [];
  let made = 0;
  class Ctx {
    state = state;
    destination = { speakers: true };
    resume = vi.fn(async () => { this.state = "running"; });
    createMediaElementSource() { return { connect: (n: unknown) => { toSpeakers.push(n); } }; }
    createGain() { return { connect() {} }; }
    createChannelSplitter() { return { connect() {} }; }
    createAnalyser() {
      const side = made++ === 0 ? "l" : "r";
      return { fftSize: 0, getFloatTimeDomainData: (buf: Float32Array) => buf.set(wave[side as "l" | "r"]) };
    }
  }
  vi.stubGlobal("AudioContext", Ctx);
  return { wave, toSpeakers };
}

async function meter() {
  vi.resetModules();
  return import("../src/components/Meter");
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("level meters", () => {
  it("hear nothing until the player is listened to", async () => {
    fakeAudio();
    const { hear } = await meter();
    expect(hear()).toBeNull();
  });

  it("still send the sound to the speakers", async () => {
    const { toSpeakers } = fakeAudio();
    const { listenTo } = await meter();
    listenTo({} as HTMLAudioElement);
    expect(toSpeakers).toContainEqual({ speakers: true });
  });

  it("follow the sound itself, left and right apart", async () => {
    const { wave } = fakeAudio();
    const { listenTo, hear } = await meter();
    listenTo({} as HTMLAudioElement);
    wave.l.fill(0.5); wave.r.fill(0.05);
    const [l, r] = hear()!;
    expect(l).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(0.5);
    wave.l.fill(0); wave.r.fill(0);
    expect(hear()).toEqual([0, 0]);
  });

  it("only listen in once, however often play is pressed", async () => {
    fakeAudio();
    const made = vi.fn();
    const Real = (globalThis as any).AudioContext;
    vi.stubGlobal("AudioContext", class extends Real { constructor() { super(); made(); } });
    const { listenTo } = await meter();
    const a = {} as HTMLAudioElement;
    listenTo(a); listenTo(a); listenTo(a);
    expect(made).toHaveBeenCalledTimes(1);
  });

  it("hear both players of an album, each once", async () => {
    const { toSpeakers } = fakeAudio();
    const { listenTo } = await meter();
    const a = {} as HTMLAudioElement, b = {} as HTMLAudioElement;
    listenTo(a); listenTo(b); listenTo(a); listenTo(b);
    expect(toSpeakers.filter((n) => (n as { speakers?: boolean }).speakers)).toHaveLength(2);
  });

  it("fall back to the waveform when the computer can't listen in", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("no audio"); } });
    const { listenTo, hear } = await meter();
    expect(() => listenTo({} as HTMLAudioElement)).not.toThrow();
    expect(hear()).toBeNull();
  });
});
