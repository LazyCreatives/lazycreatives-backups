import { useEffect, useState } from "react";

const INPUT = ["pointermove", "pointerdown", "keydown", "wheel"] as const;

// True once nobody has touched the mouse, keyboard or trackpad for `ms`.
// Any input flips it straight back to false and restarts the wait.
export function useIdle(ms: number, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) { setIdle(false); return; }
    let t = setTimeout(() => setIdle(true), ms);
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), ms); };
    for (const e of INPUT) window.addEventListener(e, wake, { passive: true });
    return () => { clearTimeout(t); for (const e of INPUT) window.removeEventListener(e, wake); };
  }, [ms, enabled]);
  return idle;
}
