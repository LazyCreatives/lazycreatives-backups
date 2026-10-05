import { useEffect, useRef } from "react";

// Two little level meters (left and right) for the player bar, like the ones on a mixer.
// They follow the song's own loudness from its waveform, with a small flicker so they move
// like real meters, and fall back to nothing when the song stops. Crate look only (CSS).
// Same file in Backups and Uploader.
export function Meter({ peaks, playing, duration, now }: {
  peaks: number[] | null; playing: boolean; duration: number; now: () => number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0, l = 0, r = 0;
    const tick = () => {
      let a = 0, b = 0;
      if (playing && peaks && peaks.length && duration > 0) {
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
