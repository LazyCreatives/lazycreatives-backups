import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { DUR, EASE_LAZY } from "./motion";
import { ARM_LENGTH, tonearmPose } from "./tonearmPose";

const W = 60, PIVOT_Y = 40;      // the pivot's spot inside the arm drawing
const SETTLE_MS = (DUR.slow + 0.2) * 1000;

// A tonearm that lifts off when you flip and lowers onto the record once it settles.
// Pure decoration: it never takes clicks or focus. With reduced motion it simply sits
// on the record. `idle` adds a slight wobble, as if the record were a touch warped.
export function Tonearm({ active, look, reduce, idle }: {
  active: number; look: "crate" | "sleeve"; reduce: boolean; idle: boolean;
}) {
  const pose = tonearmPose(look);
  const [down, setDown] = useState(reduce);

  useEffect(() => {
    if (reduce) { setDown(true); return; }
    setDown(false);
    const t = setTimeout(() => setDown(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [active, reduce, look]);

  const y = (n: number) => n + PIVOT_Y;
  const tip = y(ARM_LENGTH);
  return (
    <div className={`tonearm tonearm--${look}${down ? "" : " tonearm--up"}`} aria-hidden="true"
      style={{ left: `calc(50% + ${pose.pivot.x - W / 2}px)`, top: `calc(var(--deck-cy) + ${pose.pivot.y - PIVOT_Y}px)` }}>
      <span className="tonearm__base" />
      <motion.div className="tonearm__arm"
        initial={reduce ? false : { rotate: 0, scale: 1.04 }}
        animate={down ? { rotate: pose.play, scale: 1 } : { rotate: 0, scale: 1.04 }}
        transition={reduce ? { duration: 0 } : down
          ? { rotate: { duration: 0.7, ease: EASE_LAZY }, scale: { delay: 0.62, duration: 0.22, ease: EASE_LAZY } }
          : { scale: { duration: 0.12 }, rotate: { delay: 0.08, duration: DUR.base, ease: EASE_LAZY } }}>
        <div className={`tonearm__wobble${idle && down && !reduce ? " is-idle" : ""}`}>
          <svg width={W} height={tip + 8} viewBox={`0 0 ${W} ${tip + 8}`}>
            <rect className="ta-weight" x={W / 2 - 9} y={4} width={18} height={24} rx={4} />
            <line className="ta-tube" x1={W / 2} y1={y(0)} x2={W / 2} y2={tip - 30} />
            <circle className="ta-hub" cx={W / 2} cy={y(0)} r={8} />
            <path className="ta-shell" d={`M ${W / 2 - 7} ${tip - 32} h 14 l 1 26 h -16 z`} />
            <line className="ta-lift" x1={W / 2 + 7} y1={tip - 22} x2={W / 2 + 18} y2={tip - 26} />
            <rect className="ta-cart" x={W / 2 - 6} y={tip - 9} width={12} height={7} rx={1.5} />
            <circle className="ta-tip" cx={W / 2} cy={tip} r={1.6} />
          </svg>
        </div>
      </motion.div>
    </div>
  );
}
