import { motion } from "motion/react";
import type { CrateGroup } from "./types";

// One crate: a frosted GLASS bin (HANDOFF §6.6 — no wood, no rainbow). Square
// sleeves wear only the brand wardrobe (5 slate→Sloth-Blue tints); genre is
// communicated by name + count, never by colour. Each sleeve carries its own
// vinyl that slides up out of it on hover. The trust layer (tick-strip + label)
// states plainly how much of the crate is verified.
export function Crate({ group, onOpen, reduce }: { group: CrateGroup; onOpen: () => void; reduce: boolean }) {
  const n = group.count;
  // sleeve count scales with record count: clamp(2, round(log2(n+1))+1, 5)
  const sleeveCount = Math.min(5, Math.max(2, Math.round(Math.log2(n + 1)) + 1));
  // seeded by the crate key → stable tints/lean/spread across re-renders
  let seed = 7;
  for (const ch of group.key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const recs = Array.from({ length: sleeveCount }, (_, i) => ({
    tint: Math.min(4, Math.floor(rnd() * 5)),
    leftPct: 4 + (sleeveCount > 1 ? (i * 58) / (sleeveCount - 1) : 28) + rnd() * 5,
    rot: rnd() * 7 - 3.5,
    label: group.projects[i % group.projects.length]?.name ?? "",
  }));

  const warn = group.projects.filter((p) => p.missing > 0).length;
  const verified = group.projects.filter((p) => p.verified).length;
  const ticks = group.projects.slice(0, 12);

  return (
    <motion.section
      className="crate glass"
      layoutId={reduce ? undefined : `crate-${group.key}`}
      role="button" tabIndex={0}
      aria-label={`Open ${group.label} crate, ${n} record${n === 1 ? "" : "s"}${warn ? `, ${warn} need a look` : ""}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <div className="crate-window">
        {recs.map((r, i) => (
          <div key={i} className={`crec ct${r.tint}`}
            style={{
              left: `${r.leftPct}%`, zIndex: i,
              transform: `rotate(${r.rot}deg)`,
              ["--lean" as string]: `${r.rot.toFixed(1)}deg`,
            }}>
            <div className="crec-disc" style={{ transitionDelay: `${i * 45}ms` }} />
            <div className="crec-sleeve">
              <span className="crec-spine" />
              <span className="crec-tag mono">{r.label}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="crate-front">
        <h3>{group.label}</h3>
        <span className="ccount mono">{n} record{n === 1 ? "" : "s"}</span>
        <div className="vstrip" aria-hidden="true">
          {ticks.map((p, i) => (
            <i key={i} className={p.missing > 0 ? "warn" : p.verified ? "" : "idle"} />
          ))}
        </div>
        <span className="vlabel">
          {warn > 0
            ? <><span className="at">⚠ {warn} need{warn === 1 ? "s" : ""} a look</span> · <span className="ok">{verified} verified</span></>
            : verified === n
            ? <span className="ok">✓ all {n} verified</span>
            : <>{verified > 0 ? <span className="ok">{verified} verified</span> : <span>not backed up</span>}{verified > 0 && verified < n ? <span> · {n - verified} waiting</span> : null}</>}
        </span>
        <span className="cdig">Dig through →</span>
      </div>
    </motion.section>
  );
}
