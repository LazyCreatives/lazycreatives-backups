import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { CrateGroup, DigSort, Project } from "./types";
import { crateName, dawDisplay, genreOf, tintOf } from "./types";
import { useDigList } from "./hooks/useDigList";
import { VinylStack } from "./VinylStack";
import { EmptyCrate } from "./EmptyCrate";
import { MoreLikeThis } from "./MoreLikeThis";
import { fmtCount } from "../../format";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { Icon } from "../../components/Icon";
import { AUDITION_DELAY, useAuditionMode } from "../../audition";
import { AuditionToggle } from "../../components/Audition";
import { PlayButton, SongWave, audition, endAudition } from "../../components/Player";
import { useLook } from "../../look";

export function CrateDig({ group, all, active, setActive, digSort, setDigSort, verifiedOnly, setVerifiedOnly, onBack, onOpenProject, reduce }: {
  group: CrateGroup;
  all: Project[];          // the whole library, for More like this
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
  const [likeOf, setLikeOf] = useState<Project | null>(null);

  // A match in this crate flips Dig to it; one from another crate opens its project.
  function pick(p: Project) {
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) setActive(i); else onOpenProject?.(p.name);
  }

  // On entering the dig, move focus to the Back button (away from the unmounted shelf).
  useEffect(() => { backRef.current?.focus(); }, []);

  // With preview on hover switched on, flipping to a record plays a few seconds of its
  // newest song, like pulling it out of the crate and dropping the needle.
  const [previewing] = useAuditionMode();
  const song = cur?.latest?.path;
  useEffect(() => {
    if (!previewing || !song || !cur) return;
    const meta = { title: cur.latest!.name, project: cur.name, genre: genreOf(cur) };
    const t = window.setTimeout(() => audition(song, meta), AUDITION_DELAY);
    return () => { window.clearTimeout(t); endAudition(song); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing, song]);

  return (
    <div className={`crate-dig crate-dig--${look}`} style={{ ["--tint" as string]: group.accent }}>
      <div className="dig-header">
        <button ref={backRef} className="btn btn--ghost btn--sm" onClick={onBack} aria-label="Back to crates"><Icon name="arrowLeft" size={14} />Crates</button>
        <motion.span className="dig-title" layoutId={reduce ? undefined : `crate-${group.key}`}>{crateName(group.label)}</motion.span>
        <span className="faint mono">{fmtCount(list.length)} record{list.length === 1 ? "" : "s"}</span>
        <span className="grow" />
        <select value={digSort} onChange={(e) => { setDigSort(e.target.value as DigSort); setActive(0); }} aria-label="Sort records">
          <option value="recent">Newest first</option>
          <option value="name">Name</option>
          <option value="bpm">Tempo</option>
          <option value="size">Size</option>
        </select>
        <label className="toolchk">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => { setVerifiedOnly(e.target.checked); setActive(0); }} /> Backed up only
        </label>
        <AuditionToggle />
      </div>

      <div className="dig-stage-wrap">
        <div className="dig-wash" style={{ ["--genre-tint" as string]: tint }} />
        {list.length === 0
          ? <EmptyCrate searching title="No records match">Untick "Backed up only" to see every record in this crate.</EmptyCrate>
          : <VinylStack list={list} active={safe} setActive={setActive} reduce={reduce} onOpenProject={onOpenProject} />}
        {list.length > 1 && (
          <div className="dig-flip">
            <button className="iconbtn" aria-label="Previous record" disabled={safe === 0}
              onClick={() => setActive(Math.max(0, safe - 1))}><Icon name="chevronLeft" size={18} /></button>
            <span className="dig-flip__count" role="status" aria-live="polite">{fmtCount(safe + 1)} of {fmtCount(list.length)}</span>
            <button className="iconbtn" aria-label="Next record" disabled={safe >= list.length - 1}
              onClick={() => setActive(Math.min(list.length - 1, safe + 1))}><Icon name="chevronRight" size={18} /></button>
            <span className="dig-flip__keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> flip · <kbd>Enter</kbd> open</span>
          </div>
        )}
      </div>

      {cur && <NowOnDeck p={cur} look={look} onOpen={() => onOpenProject?.(cur.name)}
        onLike={() => setLikeOf(likeOf?.id === cur.id ? null : cur)} liking={likeOf?.id === cur.id} />}
      {likeOf && <MoreLikeThis seed={likeOf} all={all} look={look} onPick={pick} onClose={() => setLikeOf(null)} />}
    </div>
  );
}

// The record you've flipped to: what it is, its newest song to play, and a way into it.
function NowOnDeck({ p, look, onOpen, onLike, liking }: {
  p: Project; look: "crate" | "sleeve"; onOpen: () => void; onLike: () => void; liking: boolean;
}) {
  const like = <Button variant="ghost" onClick={onLike} aria-pressed={liking}>More like this</Button>;
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
          <h2 className="ondeck__name">{p.name}</h2>
          <div className="fact-chips">
            {facts.map((f) => <span key={f} className="fact-chip">{f}</span>)}
            {safeChip}
          </div>
          <span className="faint">{p.latest ? `Newest song: ${p.latest.name}` : "No songs exported from this project yet"}</span>
        </div>
        <div className="ondeck__actions">
          {p.latest && meta && <PlayButton path={p.latest.path} title={p.latest.name} meta={meta} size={46} className="playbtn--big" />}
          {like}
          <Button variant="ghost" onClick={onOpen}>Open project<Icon name="chevronRight" size={14} /></Button>
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
      {like}
      <Button variant="ghost" onClick={onOpen}>Open project<Icon name="chevronRight" size={14} /></Button>
    </div>
  );
}
