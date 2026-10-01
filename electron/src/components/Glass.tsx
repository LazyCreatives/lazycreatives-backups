import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Background waveform: slow, breathing, "wakes up" while the sloth works.
   Shared by Home and Crates — same design constants (HANDOFF §5: do not speed up). */
export function WaveBackdrop({ energized }: { energized: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const target = useRef(0);
  target.current = energized ? 1 : 0;
  useEffect(() => {
    if (reduceMotion()) return;
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    let w = 0, h = 0, raf = 0, energy = 0;
    const size = () => {
      w = cv.width = innerWidth * devicePixelRatio;
      h = cv.height = innerHeight * devicePixelRatio;
      cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
    };
    size();
    addEventListener("resize", size);
    const layers = [
      { amp: 0.030, len: 1.4, speed: 0.00007, y: 0.880, col: "59,79,93", alpha: 0.30, lw: 1.5, fill: 0.05 },
      { amp: 0.026, len: 1.9, speed: 0.00010, y: 0.905, col: "134,179,211", alpha: 0.22, lw: 1.5, fill: 0.045 },
      { amp: 0.020, len: 2.6, speed: 0.00013, y: 0.930, col: "134,179,211", alpha: 0.35, lw: 2.0, fill: 0.07 },
      { amp: 0.013, len: 3.4, speed: 0.00018, y: 0.955, col: "74,222,128", alpha: 0.16, lw: 1.2, fill: 0.025 },
    ];
    const wave = (L: typeof layers[0], x: number, t: number, amp: number) => {
      const u = (x / w) * Math.PI * 2 * L.len;
      return h * L.y
        + Math.sin(u + t * L.speed * Math.PI * 0.4) * amp * (1 + 0.1 * Math.sin(t * 0.00003 + L.y * 9))
        + Math.sin(u * 1.7 + t * L.speed * 1.8) * amp * 0.15;
    };
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      energy += (target.current - energy) * 0.02;
      for (const L of layers) {
        const amp = h * L.amp * (1 + energy * 2.2);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 6 * devicePixelRatio) {
          const y = wave(L, x, t, amp);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.save();
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        const grad = ctx.createLinearGradient(0, h * (L.y - L.amp), 0, h);
        grad.addColorStop(0, `rgba(${L.col},${L.fill * (1 + energy)})`);
        grad.addColorStop(1, `rgba(${L.col},0)`);
        ctx.fillStyle = grad; ctx.fill();
        ctx.restore();
        ctx.beginPath();
        for (let x = 0; x <= w; x += 6 * devicePixelRatio) {
          const y = wave(L, x, t, amp);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${L.col},${L.alpha * (1 + energy * 0.8)})`;
        ctx.lineWidth = L.lw * devicePixelRatio;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const vis = () => {  // don't burn battery while the window is hidden
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return <canvas id="bgWave" ref={ref} aria-hidden="true" />;
}

/* Pointer-tracked specular highlight on every .glass panel under `ref`. */
export function useSpecular(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current; if (!root) return;
    const move = (e: MouseEvent) => {
      root.querySelectorAll<HTMLElement>(".glass").forEach((p) => {
        const r = p.getBoundingClientRect();
        p.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
        p.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
      });
    };
    addEventListener("mousemove", move, { passive: true });
    return () => removeEventListener("mousemove", move);
  }, []);
}
