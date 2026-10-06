import { motion } from "motion/react";
import { DUR, EASE_GLIDE } from "./motion";
import type { CrateGroup } from "./types";
import { Crate } from "./Crate";

// Grid of crates with a staggered entrance; `layout` makes them FLIP to new positions
// when grouping/sort/search changes instead of snapping.
export function CrateShelf({ groups, onOpen, reduce, label }: {
  groups: CrateGroup[]; onOpen: (key: string) => void; reduce: boolean; label?: string;
}) {
  const shelf = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.07 } } };
  const crateIn = {
    hidden: { opacity: 0, y: reduce ? 0 : 22 },
    show: { opacity: 1, y: 0, transition: { duration: reduce ? 0.18 : DUR.open, ease: EASE_GLIDE } },
  };
  return (
    <>
    {/* for screen readers: the crates' names are level-3 headings, so a level-2 one goes first */}
    {!label && <h2 className="crate-vh">Crates</h2>}
    <motion.div className="shelf" variants={shelf} initial="hidden" animate="show" role="list" aria-label={label ?? "Crates"}>
      {groups.map((g) => (
        <motion.div key={g.key} data-nav-key={g.key} layout={!reduce} variants={crateIn} role="listitem">
          <Crate group={g} onOpen={() => onOpen(g.key)} reduce={reduce} />
        </motion.div>
      ))}
    </motion.div>
    </>
  );
}
