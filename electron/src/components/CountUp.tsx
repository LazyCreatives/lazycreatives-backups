import { useEffect, useRef, useState } from "react";

// Animate a number from its previous value to `target` with an ease-out, using
// requestAnimationFrame. Reused for the dashboard tiles' "race up" effect.
export function useCountUp(target: number, duration = 950): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  const prevTarget = useRef(target);

  useEffect(() => {
    // honour reduced-motion: jump straight to the value
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVal(target); prevTarget.current = target; return;
    }
    fromRef.current = prevTarget.current;
    prevTarget.current = target;
    let raf = 0;
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(fromRef.current + (target - fromRef.current) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return val;
}

export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const v = useCountUp(value);
  return <>{format ? format(v) : Math.round(v).toLocaleString()}</>;
}
