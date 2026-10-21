import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { DUR, EASE_GLIDE } from "./motion";
import type { CrateGroup } from "./types";
import { Crate } from "./Crate";
import { Icon } from "../../components/Icon";
import { rowKey } from "../../components/a11y";
import { useLook } from "../../look";

// Crates drawn at first; more as the end of the shelf comes near, so thousands of
// folders don't all get drawn (with their covers) before the screen shows.
const PAGE = 48;

// Grid of crates with a staggered entrance; `layout` makes them FLIP to new positions
// when grouping/sort/search changes instead of snapping. A shelf too big to draw at
// once skips the FLIP, which would measure every crate on each change.
export function CrateShelf({ groups, onOpen, reduce, label, more }: {
  groups: CrateGroup[]; onOpen: (key: string) => void; reduce: boolean; label?: string;
  more?: { title: string; count: string; onOpen: () => void };  // a last crate that opens the rest
}) {
  const [limit, setLimit] = useState(PAGE);
  const big = groups.length > PAGE;
  const sentinel = useRef<HTMLDivElement | null>(null);
  const hasMore = groups.length > limit;
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setLimit(groups.length); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((n) => n + PAGE); },
      { root: document.querySelector(".main"), rootMargin: "0px 0px 1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, limit, groups.length]);
  const shelf = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : big ? 0.02 : 0.07 } } };
  const crateIn = {
    hidden: { opacity: 0, y: reduce ? 0 : 22 },
    show: { opacity: 1, y: 0, transition: { duration: reduce ? 0.18 : DUR.open, ease: EASE_GLIDE } },
  };
  return (
    <>
    {/* for screen readers: the crates' names are level-3 headings, so a level-2 one goes first */}
    {!label && <h2 className="crate-vh">Crates</h2>}
    <motion.div className="shelf" variants={shelf} initial="hidden" animate="show" role="list" aria-label={label ?? "Crates"}>
      {groups.slice(0, limit).map((g) => (
        <motion.div key={g.key} data-nav-key={g.key} layout={!reduce && !big} variants={crateIn} role="listitem">
          <Crate group={g} onOpen={() => onOpen(g.key)} reduce={reduce} />
        </motion.div>
      ))}
      {more && !hasMore && (
        <motion.div key="__more__" variants={crateIn} role="listitem">
          <MoreCrate {...more} />
        </motion.div>
      )}
    </motion.div>
    {hasMore && <div ref={sentinel} aria-hidden="true" />}
    </>
  );
}

// The crate after the first few folders: opens every folder, with a search by name.
function MoreCrate({ title, count, onOpen }: { title: string; count: string; onOpen: () => void }) {
  const [look] = useLook();
  const common = { role: "button", tabIndex: 0, onClick: onOpen, onKeyDown: rowKey(onOpen) };
  if (look === "sleeve") {
    return (
      <div className="boxset boxset--more boxset--thick2" {...common}>
        <div className="boxset__art"><Icon name="search" size={34} /></div>
        <div className="sleeve__meta">
          <span className="sleeve__name">{title}</span>
          <span className="sleeve__sub">{count} · <span className="cdig">Find one<Icon name="chevronRight" size={13} /></span></span>
        </div>
      </div>
    );
  }
  return (
    <div className="bin bin--more" {...common}>
      <div className="bin__window"><Icon name="search" size={34} /></div>
      <div className="bin__front">
        <div className="bin__title"><h3>{title}</h3></div>
        <div className="bin__foot"><span className="vlabel">{count}</span><span className="cdig">Find one<Icon name="chevronRight" size={13} /></span></div>
      </div>
    </div>
  );
}
