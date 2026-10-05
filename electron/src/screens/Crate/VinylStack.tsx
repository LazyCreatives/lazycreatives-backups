import { useEffect, useRef } from "react";
import { motion, type PanInfo } from "motion/react";
import { DUR, EASE_LAZY } from "./motion";
import type { Project } from "./types";
import { tintOf } from "./types";
import { useLook } from "../../look";
import { Vinyl } from "./Vinyl";

const WINDOW = 10;                     // virtualise to ±10 (≤21 mounted nodes)
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Resting transform per record as a function of its offset from `active`. We change
// the target on flip and let motion tween it (persistent elements, not remounted).
function vinylTransform(offset: number, reduce: boolean, flat: boolean) {
  const ao = Math.abs(offset);
  if (reduce) {  // flat, fade-only — no vestibular rotation
    return { rotateX: 0, z: 0, y: offset * 6, scale: offset === 0 ? 1.04 : 1,
             opacity: ao === 0 ? 1 : ao > 6 ? 0 : 0.4, zIndex: 120 - ao };
  }
  if (offset < 0) return { rotateX: -72, z: 150, y: 60, scale: 1, opacity: 0, zIndex: 0 };
  if (offset === 0) return { rotateX: flat ? 0 : -3, z: 50, y: 0, scale: 1.02, opacity: 1, zIndex: 120 };
  const rx = Math.min(12, 4 + ao);
  // the records behind stand a little taller each, so their tops show like a crate's
  return { rotateX: rx, z: -ao * 16, y: -Math.min(ao, 5) * 34, scale: 1 - ao * 0.015,
           opacity: ao > 5 ? 0 : 1, zIndex: 120 - ao };
}

export function VinylStack({ list, active, setActive, reduce, onOpenProject }: {
  list: Project[];
  active: number;
  setActive: (updater: number | ((a: number) => number)) => void;
  reduce: boolean;
  onOpenProject?: (name: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const wheelLock = useRef(0);
  const [look] = useLook();

  // Roving focus: only move DOM focus to the active record when focus is already
  // inside the stage (so we never steal focus on mount / from elsewhere).
  useEffect(() => {
    const stage = stageRef.current;
    if (stage && stage.contains(document.activeElement) && document.activeElement !== activeRef.current) {
      activeRef.current?.focus();
    }
  }, [active]);

  const lo = Math.max(0, active - WINDOW);
  const hi = Math.min(list.length, active + WINDOW + 1);
  const windowed = list.slice(lo, hi);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;  // Alt/Cmd+arrows go back/forward a page
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); setActive((a) => clamp(a - 1, 0, list.length - 1)); break;
      case "ArrowRight": e.preventDefault(); setActive((a) => clamp(a + 1, 0, list.length - 1)); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(list.length - 1); break;
      case "Enter": case " ":
        e.preventDefault(); if (list[active]) onOpenProject?.(list[active].name); break;
    }
  }

  function onDragEnd(_: unknown, info: PanInfo) {
    const steps = Math.round(-info.offset.x / 90 + -info.velocity.x / 1200);
    if (steps) setActive((a) => clamp(a + steps, 0, list.length - 1));
  }

  function onWheel(e: React.WheelEvent) {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = Date.now();
    if (Math.abs(dx) < 8 || now - wheelLock.current < 80) return;
    wheelLock.current = now;
    setActive((a) => clamp(a + (dx > 0 ? 1 : -1), 0, list.length - 1));
  }

  return (
    <motion.div className="stage" ref={stageRef}
      drag={reduce ? false : "x"} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.12}
      onDragEnd={reduce ? undefined : onDragEnd} onWheel={onWheel} onKeyDown={onKeyDown}
      role="group" aria-label="Records — arrow keys to flip, Enter to open">
      {windowed.map((p, k) => {
        const i = lo + k;
        const isActive = i === active;
        return (
          <motion.div key={p.id} className={`rec rec--${look}`}
            ref={isActive ? activeRef : undefined}
            tabIndex={isActive ? 0 : -1}
            aria-label={`${p.name}, ${p.bpm ?? "unknown"} BPM`}
            aria-setsize={list.length} aria-posinset={i + 1}
            style={{ ["--tint" as string]: tintOf(p), transformPerspective: 1150 }}
            animate={vinylTransform(i - active, reduce, look === "sleeve")}
            transition={{ duration: reduce ? 0.18 : DUR.slow, ease: EASE_LAZY }}
            onClick={() => { if (isActive) onOpenProject?.(p.name); else setActive(i); }}
          >
            <Vinyl project={p} isActive={isActive} reduce={reduce} look={look} />
          </motion.div>
        );
      })}
    </motion.div>
  );
}
