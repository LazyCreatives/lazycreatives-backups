import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import type { CrateGroup, DigSort, Project } from "./types";
import { crateName, dawDisplay, genreOf, tintOf } from "./types";
import { useDigList } from "./hooks/useDigList";
import { VinylStack } from "./VinylStack";
import { EmptyCrate } from "./EmptyCrate";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { Icon } from "../../components/Icon";
import { PlayButton, SongWave } from "../../components/Player";
import { useLook } from "../../look";

export function CrateDig({ group, active, setActive, digSort, setDigSort, verifiedOnly, setVerifiedOnly, onBack, onOpenProject, reduce }: {
  group: CrateGroup;
  active: number;
  setActive: (updater: number | ((a: number) => number)) => void;
  digSort: DigSort; setDigSort: (s: DigSort) => void;
  verifiedOnly: boolean; setVerifiedOnly: (v: boolean) => void;
  onBack: () => void;
  onOpenProject?: (name: string) => void;
  reduce: boolean;
}) {
  const [look] = useLook();
  const list = useDigList(group.projects, digSort, verifiedOnly);
  const safe = Math.min(active, Math.max(0, list.length - 1));
  const cur = list[safe];
  const tint = cur ? tintOf(cur) : "transparent";
  const backRef = useRef<HTMLButtonElement>(null);

  // On entering the dig, move focus to the Back button (away from the unmounted shelf).
  useEffect(() => { backRef.current?.focus(); }, []);

  return (
    <div className={`crate-dig crate-dig--${look}`} style={{ ["--tint" as string]: group.accent }}>
      <div className="dig-header">
        <button ref={backRef} className="btn btn--ghost btn--sm" onClick={onBack} aria-label="Back to crates">← Crates</button>
        <motion.span className="dig-title display" layoutId={reduce ? undefined : `crate-${group.key}`}>{crateName(group.label)}</motion.span>
        <span className="faint mono">{list.length} record{list.length === 1 ? "" : "s"}</span>
        <span className="grow" />
        <select value={digSort} onChange={(e) => { setDigSort(e.target.value as DigSort); setActive(0); }} aria-label="Sort records">
          <option value="recent">Newest first</option>
          <option value="name">Name</option>
          <option value="bpm">BPM</option>
          <option value="size">Size</option>
        </select>
        <label className="toolchk">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => { setVerifiedOnly(e.target.checked); setActive(0); }} /> Backed up only
        </label>
      </div>

      <div className="dig-stage-wrap">
        <div className="dig-wash" style={{ ["--genre-tint" as string]: tint }} />
        {list.length === 0
          ? <EmptyCrate message="No records match. Try clearing 'Backed up only'." />
          : <VinylStack list={list} active={safe} setActive={setActive} reduce={reduce} onOpenProject={onOpenProject} />}
        {list.length > 1 && (
          <div className="dig-flip">
            <button className="iconbtn" aria-label="Previous record" disabled={safe === 0}
              onClick={() => setActive(Math.max(0, safe - 1))}>‹</button>
            <span className="mono" role="status" aria-live="polite">{safe + 1} of {list.length}</span>
            <button className="iconbtn" aria-label="Next record" disabled={safe >= list.length - 1}
              onClick={() => setActive(Math.min(list.length - 1, safe + 1))}>›</button>
          </div>
        )}
      </div>

      {cur && <NowOnDeck p={cur} look={look} onOpen={() => onOpenProject?.(cur.name)} />}
    </div>
  );
}

// The record you've flipped to: what it is, its newest song to play, and a way into it.
function NowOnDeck({ p, look, onOpen }: { p: Project; look: "crate" | "sleeve"; onOpen: () => void }) {
  const genre = genreOf(p);
  const meta = p.latest ? { title: p.latest.name, project: p.name, genre } : undefined;
  const facts = [
    genre ?? "No genre yet",
    p.bpm ? `${p.bpm} BPM` : null,
    dawDisplay(p.daw),
  ].filter(Boolean) as string[];
  const safeChip = p.missing > 0
    ? <span className="fact-chip fact-chip--warn">{p.missing} missing</span>
    : p.verified ? <span className="fact-chip fact-chip--ok">Backed up</span>
    : <span className="fact-chip">Not backed up</span>;

  if (look === "sleeve") {
    return (
      <div className="ondeck ondeck--sleeve">
        <div className="ondeck__text">
          <span className="eyebrow">{facts.join(" · ")}</span>
          <h2 className="ondeck__name">{p.name}</h2>
          <span className="faint">{p.latest ? `Newest song: ${p.latest.name}` : "No songs exported from this project yet"}</span>
        </div>
        <div className="ondeck__actions">
          {p.latest && meta && <PlayButton path={p.latest.path} title={p.latest.name} meta={meta} size={46} className="playbtn--big" />}
          <Button variant="ghost" onClick={onOpen}>Open project <Icon name="external" size={14} /></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ondeck ondeck--crate">
      <span className="stripe" style={{ background: tintOf(p) }} />
      <Cover name={p.name} genre={genre} size={64} label={false} />
      <div className="ondeck__text">
        <b className="ondeck__title">{p.name}</b>
        <div className="fact-chips">
          {facts.map((f) => <span key={f} className="fact-chip">{f}</span>)}
          {safeChip}
        </div>
      </div>
      {p.latest && meta
        ? <div className="ondeck__song">
            <PlayButton path={p.latest.path} title={p.latest.name} meta={meta} size={40} className="playbtn--big" />
            <div className="ondeck__wave">
              <span className="faint">{p.latest.name}</span>
              <SongWave path={p.latest.path} meta={meta} height={40} />
            </div>
          </div>
        : <div className="ondeck__song faint">No songs exported from this project yet</div>}
      <Button variant="ghost" onClick={onOpen}>Open project</Button>
    </div>
  );
}
