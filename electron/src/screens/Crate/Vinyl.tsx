import { motion } from "motion/react";
import { SPIN_SECONDS, DUR, EASE_LAZY } from "./motion";
import type { Project } from "./types";
import { genreOf } from "./types";
import { Cover } from "../../components/Cover";

// One record's faces. Crate look: a vinyl whose centre label is the project's cover; the
// record (.platter) spins on the ACTIVE record only. Sleeve look: the square cover
// itself, with the record peeking out the side.
// --tint is set by the parent .rec wrapper in VinylStack.
export function Vinyl({ project, isActive, reduce, look }: {
  project: Project; isActive: boolean; reduce: boolean; look: "crate" | "sleeve";
}) {
  const spinning = isActive && !reduce;
  const badge = project.verified && (
    <motion.span className="vbadge" initial={false}
      animate={isActive && !reduce ? { scale: [0, 1.25, 1] } : { scale: 1 }}
      transition={{ duration: reduce ? 0 : DUR.base, ease: EASE_LAZY }}
      aria-hidden="true">✓</motion.span>
  );

  if (look === "sleeve") {
    return (
      <>
        <motion.div className="rec__peek" initial={false}
          animate={{ x: isActive && !reduce ? "34%" : "8%" }}
          transition={{ duration: reduce ? 0 : DUR.slow, ease: EASE_LAZY }} />
        <Cover name={project.name} genre={genreOf(project)} className="rec__cover" />
        {badge}
      </>
    );
  }

  return (
    <>
      <div className="disc" />
      <motion.div className="platter"
        animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={spinning ? { duration: SPIN_SECONDS, ease: "linear", repeat: Infinity } : { duration: 0 }}
        style={{ willChange: spinning ? "transform" : "auto" }}
      >
        <div className="label__art"><Cover name={project.name} genre={genreOf(project)} label={false} /></div>
      </motion.div>
      <div className="hole" />
      {badge}
    </>
  );
}
