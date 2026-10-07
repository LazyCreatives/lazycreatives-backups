import { useEffect, useRef } from "react";

// Two little level meters (left and right) for the player bar, like the ones on a mixer.
// They listen to the music itself as it comes out, so they move with every beat and stop
// the moment it pauses. If the computer can't listen in, they follow the song's waveform
// instead. Crate look only (CSS). With Reduce Motion turned on they stay still.
// Same file in Backups and Uploader.

let ears: {
  ctx: AudioContext; both: GainNode; l: AnalyserNode; r: AnalyserNode; buf: Float32Array<ArrayBuffer>;
  heard: WeakSet<HTMLAudioElement>;
} | null | undefined;

// Let the meters hear the player. Called when someone presses play: the sound still goes
// straight to the speakers, and a copy is split into left and right for the meters.
// An album uses two players to blend songs, so both are heard. Each player is only ever
// listened to once; nothing is saved or changed, it all happens in memory.
export function listenTo(a: HTMLAudioElement) {
  if (ears === null || typeof AudioContext === "undefined") return;
  try {
    if (!ears) {
      const ctx = new AudioContext();
      // a mono song shows on both meters
      const both = ctx.createGain();
      both.channelCount = 2; both.channelCountMode = "explicit"; both.channelInterpretation = "speakers";
      const split = ctx.createChannelSplitter(2);
      const l = ctx.createAnalyser(), r = ctx.createAnalyser();
      l.fftSize = r.fftSize = 1024;
      both.connect(split); split.connect(l, 0); split.connect(r, 1);
      ears = { ctx, both, l, r, buf: new Float32Array(1024), heard: new WeakSet() };
    }
    if (!ears.heard.has(a)) {
      const src = ears.ctx.createMediaElementSource(a);
      src.connect(ears.ctx.destination);
      src.connect(ears.both);
      ears.heard.add(a);
    }
    if (ears.ctx.state === "suspended") ears.ctx.resume().catch(() => {});
  } catch {
    if (!ears) ears = null;
  }
}

// How loud one side is right now, 0 to 1 on a mixer's scale (silence to 0 dB, from -40 dB).
function loudness(an: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  if (rms < 1e-5) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 40) / 40));
}

// Left and right right now, or null when the meters can't hear the player.
export function hear(): [number, number] | null {
  if (!ears || ears.ctx.state !== "running") return null;
  return [loudness(ears.l, ears.buf), loudness(ears.r, ears.buf)];
}

export function Meter({ peaks, playing, duration, now }: {
  peaks: number[] | null; playing: boolean; duration: number; now: () => number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0, l = 0, r = 0;
    // Reduce Motion: the meters stay still
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty("--l", "0"); el.style.setProperty("--r", "0");
      return;
    }
    const tick = () => {
      let a = 0, b = 0;
      const heard = playing ? hear() : null;
      if (heard) {
        [a, b] = heard;
      } else if (playing && peaks && peaks.length && duration > 0) {
        const at = Math.min(peaks.length - 1, Math.floor((now() / duration) * peaks.length));
        const p = peaks[at], q = peaks[Math.min(peaks.length - 1, at + 1)];
        a = p * (0.8 + Math.random() * 0.2);
        b = (p * 0.6 + q * 0.4) * (0.8 + Math.random() * 0.2);
      }
      // jump up at once, fall back slowly, as meters do
      l = a > l ? a : l * 0.9;
      r = b > r ? b : r * 0.9;
      el.style.setProperty("--l", l.toFixed(3));
      el.style.setProperty("--r", r.toFixed(3));
      if (playing || l > 0.01 || r > 0.01) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [peaks, playing, duration, now]);
  return (
    <div className="meter" ref={ref} aria-hidden="true">
      <span className="meter__ch"><i style={{ width: "calc(var(--l, 0) * 100%)" }} /></span>
      <span className="meter__ch"><i style={{ width: "calc(var(--r, 0) * 100%)" }} /></span>
    </div>
  );
}
