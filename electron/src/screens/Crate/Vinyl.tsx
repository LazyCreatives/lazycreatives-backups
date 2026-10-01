import { motion } from "motion/react";
import { SPIN_SECONDS, DUR, EASE_LAZY } from "./motion";
import type { Project } from "./types";

// One record's inner faces. The grooves layer (.platter) spins on the ACTIVE record
// only; the label/hole/badge are siblings so they stay upright + readable (and don't
// repaint every frame). --tint is set by the parent .rec wrapper in VinylStack.
export function Vinyl({ project, isActive, reduce }: { project: Project; isActive: boolean; reduce: boolean }) {
  const spinning = isActive && !reduce;
  return (
    <>
      <div className="disc" />
      <motion.div className="platter"
        animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={spinning ? { duration: SPIN_SECONDS, ease: "linear", repeat: Infinity } : { duration: 0 }}
        style={{ willChange: spinning ? "transform" : "auto" }}
      />
      <div className="label">
        <div>
          <div className="label__name">{project.name}</div>
          <div className="label__meta">
            {project.bpm ? `${project.bpm} BPM` : "— BPM"}{project.musicalKey ? ` · ${project.musicalKey}` : ""}
          </div>
        </div>
      </div>
      <div className="hole" />
      {project.verified && (
        <motion.span className="vbadge" initial={false}
          animate={isActive && !reduce ? { scale: [0, 1.25, 1] } : { scale: 1 }}
          transition={{ duration: reduce ? 0 : DUR.base, ease: EASE_LAZY }}
          aria-hidden="true">✓</motion.span>
      )}
    </>
  );
}
