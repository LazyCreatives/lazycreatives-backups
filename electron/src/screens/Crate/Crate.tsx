import { motion } from "motion/react";
import type { CrateGroup } from "./types";
import { crateName, genreOf } from "./types";
import { Cover } from "../../components/Cover";
import { useLook } from "../../look";

// One crate on the shelf. Crate look: a record bin with the real covers of the first
// few projects standing in it, a colour band and the crate's name on the front.
// Sleeve look: a box set, its front a mosaic of up to four covers.
// Both carry the same trust line: how much of the crate is safely backed up.
export function Crate({ group, onOpen, reduce }: { group: CrateGroup; onOpen: () => void; reduce: boolean }) {
  const [look] = useLook();
  const n = group.count;
  const name = crateName(group.label);
  const warn = group.projects.filter((p) => p.missing > 0).length;
  const verified = group.projects.filter((p) => p.verified).length;
  const label = `Open ${name} crate, ${n} record${n === 1 ? "" : "s"}${warn ? `, ${warn} need a look` : ""}`;
  const trust = (
    <span className="vlabel">
      {warn > 0
        ? <><span className="at">{warn} need{warn === 1 ? "s" : ""} a look</span> · <span className="ok">{verified} safe</span></>
        : verified === n
        ? <span className="ok">All {n} safe</span>
        : verified > 0
        ? <><span className="ok">{verified} safe</span> · {n - verified} not backed up</>
        : <span>Not backed up yet</span>}
    </span>
  );
  const common = {
    layoutId: reduce ? undefined : `crate-${group.key}`,
    role: "button", tabIndex: 0, "aria-label": label, onClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } },
    style: { ["--tint" as string]: group.accent },
  };

  if (look === "sleeve") {
    const four = group.projects.slice(0, 4);
    return (
      <motion.section className={`boxset boxset--${Math.min(4, four.length)}`} {...common}>
        <div className="boxset__art">
          {four.map((p) => <Cover key={p.id} name={p.name} genre={genreOf(p)} label={four.length === 1} />)}
          <span className="sleeve__badge">{n} record{n === 1 ? "" : "s"}</span>
        </div>
        <div className="sleeve__meta">
          <span className="sleeve__name">{name}</span>
          <span className="sleeve__sub">{trust}</span>
        </div>
      </motion.section>
    );
  }

  // Crate look: covers stand in the bin; each has its record tucked inside, which slides
  // up on hover. Only real projects are shown, never repeats.
  const shown = group.projects.slice(0, 4);
  let seed = 7;
  for (const ch of group.key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const span = Math.min(54, (shown.length - 1) * 20);
  const recs = shown.map((p, i) => ({
    p,
    leftPct: 50 - span / 2 + (shown.length > 1 ? (i * span) / (shown.length - 1) : 0),
    rot: rnd() * 6 - 3,
  }));
  const ticks = group.projects.slice(0, 16);

  return (
    <motion.section className="bin" {...common}>
      <div className="bin__window">
        {recs.map((r, i) => (
          <div key={r.p.id} className="crec"
            style={{ left: `${r.leftPct}%`, zIndex: i, transform: `translateX(-50%) rotate(${r.rot}deg)`, ["--lean" as string]: `${r.rot.toFixed(1)}deg` }}>
            <div className="crec-disc" style={{ transitionDelay: `${i * 45}ms` }} />
            <Cover name={r.p.name} genre={genreOf(r.p)} size={96} className="crec-sleeve" label={false} />
          </div>
        ))}
      </div>
      <div className="bin__front">
        <div className="bin__title">
          <h3 className="display">{name}</h3>
          <span className="ccount mono">{n} record{n === 1 ? "" : "s"}</span>
        </div>
        <div className="vstrip" aria-hidden="true">
          {ticks.map((p, i) => <i key={i} className={p.missing > 0 ? "warn" : p.verified ? "" : "idle"} />)}
        </div>
        <div className="bin__foot">{trust}<span className="cdig">Dig through →</span></div>
      </div>
    </motion.section>
  );
}
