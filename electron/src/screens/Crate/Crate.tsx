import { motion } from "motion/react";
import type { CrateGroup } from "./types";
import { crateName, genreOf } from "./types";
import { countStatuses } from "../../libraryFilter";
import { rowKey } from "../../components/a11y";
import { Cover } from "../../components/Cover";
import { useLook } from "../../look";
import { Icon } from "../../components/Icon";
import { fmtCount } from "../../format";
import { openMenu } from "../../components/Desktop";
import { pickCrateColor } from "../../components/GenrePick";

// One crate on the shelf. Crate look: a record bin with the real covers of the first
// few projects standing in it, a colour band and the crate's name on the front.
// Sleeve look: a box set, its front a mosaic of up to four covers.
// Both carry the same trust line: how much of the crate is safely backed up, and both
// show how full the crate is: up to eight covers packed in, tighter as it fills (Crate),
// or a box set that gets thicker the more records it holds (Sleeve).
export function Crate({ group, onOpen, reduce }: { group: CrateGroup; onOpen: () => void; reduce: boolean }) {
  const [look] = useLook();
  const n = group.count;
  const name = crateName(group.label);
  // counted the same way as the Library and Home: a record missing samples needs a
  // look and isn't counted as safe, and one saved since its backup is "changed"
  const c = countStatuses(group.projects.map((p) => ({
    missing_count: p.missing, changed: p.status === "changed", backed_up: p.verified,
  })));
  const warn = c.missing, safe = c.safe;
  const records = `${fmtCount(n)} record${n === 1 ? "" : "s"}`;
  // the same words as plain text, for the tooltip when the line is cut short
  const trustText = safe === n ? `All ${fmtCount(n)} safe`
    : safe === 0 && warn === 0 && c.changed === 0 ? "Not backed up yet"
    : [warn > 0 ? `${fmtCount(warn)} need${warn === 1 ? "s" : ""} a look` : "", `${fmtCount(safe)} safe`,
       c.changed > 0 ? `${fmtCount(c.changed)} changed` : "", c.none > 0 ? `${fmtCount(c.none)} not backed up` : ""].filter(Boolean).join(" · ");
  const trust = (
    <span className="vlabel" title={trustText}>
      {safe === n
        ? <span className="ok">All {fmtCount(n)} safe</span>
        : safe === 0 && warn === 0 && c.changed === 0
        ? <span>Not backed up yet</span>
        : <>
            {warn > 0 && <><span className="at">{fmtCount(warn)} need{warn === 1 ? "s" : ""} a look</span>{" · "}</>}
            <span className="ok">{fmtCount(safe)} safe</span>
            {c.changed > 0 && ` · ${fmtCount(c.changed)} changed`}
            {c.none > 0 && ` · ${fmtCount(c.none)} not backed up`}
          </>}
    </span>
  );
  // No aria-label: the crate is named by what it shows (name, count, how safe it is),
  // so what you hear is what you see.
  const genre = group.key.startsWith("genre:") && group.label !== "Unknown" ? group.label : null;
  const common = {
    layoutId: reduce ? undefined : `crate-${group.key}`,
    role: "button", tabIndex: 0, onClick: onOpen,
    onKeyDown: rowKey(onOpen),
    onContextMenu: (e: React.MouseEvent) => openMenu(e, [
      { label: "Dig through", onClick: onOpen },
      ...(genre ? [{ label: "Crate colour…", onClick: () => pickCrateColor(genre, group.projects[0]?.name) }] : []),
    ]),
    style: { ["--tint" as string]: group.accent },
  };
  // the box gets an extra edge at 2, 6 and 15 records
  const thick = n >= 15 ? 3 : n >= 6 ? 2 : n >= 2 ? 1 : 0;

  if (look === "sleeve") {
    const four = group.projects.slice(0, 4);
    return (
      <motion.div className={`boxset boxset--${Math.min(4, four.length)} boxset--thick${thick}`} {...common}>
        <div className="boxset__art">
          {four.map((p) => <Cover key={p.id} name={p.name} genre={genreOf(p)} label={four.length === 1} />)}
          <span className="sleeve__badge">{records}</span>
        </div>
        <div className="sleeve__meta">
          <span className="sleeve__name" title={name}>{name}</span>
          <span className="sleeve__sub">{trust}</span>
        </div>
      </motion.div>
    );
  }

  // Crate look: covers stand in the bin; each has its record tucked inside, which slides
  // up on hover. Only real projects are shown, never repeats.
  const shown = group.projects.slice(0, 8);
  let seed = 7;
  for (const ch of group.key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const span = Math.min(68, (shown.length - 1) * (shown.length > 4 ? 10 : 20));
  const recs = shown.map((p, i) => ({
    p,
    leftPct: 50 - span / 2 + (shown.length > 1 ? (i * span) / (shown.length - 1) : 0),
    rot: rnd() * 6 - 3,
  }));
  const ticks = group.projects.slice(0, 16);

  return (
    <motion.div className="bin" {...common}>
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
          <h3 title={name}>{name}</h3>
          <span className="ccount mono">{records}</span>
        </div>
        <div className="vstrip" aria-hidden="true">
          {ticks.map((p, i) => <i key={i} className={p.missing > 0 ? "warn" : p.verified ? "" : "idle"} />)}
        </div>
        <div className="bin__foot">{trust}<span className="cdig">Dig through<Icon name="chevronRight" size={13} /></span></div>
      </div>
    </motion.div>
  );
}
