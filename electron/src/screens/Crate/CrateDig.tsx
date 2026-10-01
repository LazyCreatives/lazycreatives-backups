import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import type { CrateGroup, DigSort } from "./types";
import { GENRE_COLOR } from "./types";
import { useDigList } from "./hooks/useDigList";
import { VinylStack } from "./VinylStack";
import { EmptyCrate } from "./EmptyCrate";

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
  const list = useDigList(group.projects, digSort, verifiedOnly);
  const safe = Math.min(active, Math.max(0, list.length - 1));
  const cur = list[safe];
  const tint = cur ? (GENRE_COLOR[cur.genre] ?? GENRE_COLOR.Unknown) : "transparent";
  const backRef = useRef<HTMLButtonElement>(null);

  // On entering the dig, move focus to the Back button (away from the unmounted shelf).
  useEffect(() => { backRef.current?.focus(); }, []);

  return (
    <div className="crate-dig">
      <div className="dig-header">
        <button ref={backRef} className="btn btn--ghost btn--sm" onClick={onBack} aria-label="Back to crates">← Crates</button>
        <motion.span className="dig-title" layoutId={reduce ? undefined : `crate-${group.key}`}>{group.label}</motion.span>
        <span className="sub" style={{ margin: 0 }}>{list.length} record{list.length === 1 ? "" : "s"}</span>
      </div>

      <div className="dig-controls">
        <select value={digSort} onChange={(e) => { setDigSort(e.target.value as DigSort); setActive(0); }} aria-label="Sort records">
          <option value="recent">Recent</option>
          <option value="name">Name</option>
          <option value="bpm">BPM</option>
          <option value="size">Size</option>
        </select>
        <label className="toolchk">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => { setVerifiedOnly(e.target.checked); setActive(0); }} /> Verified only
        </label>
      </div>

      <div className="dig-stage-wrap">
        <div className="dig-wash" style={{ ["--genre-tint" as string]: tint }} />
        {list.length === 0
          ? <EmptyCrate message="No records match — try clearing 'Verified only'." />
          : <VinylStack list={list} active={safe} setActive={setActive} reduce={reduce} onOpenProject={onOpenProject} />}
      </div>

      {list.length > 0 && (
        <div className="dig-readout mono" role="status" aria-live="polite" aria-atomic="true">
          {cur && `${cur.name} — ${cur.bpm ? `${cur.bpm} BPM` : "— BPM"} — ${cur.musicalKey ?? "—"} — ${safe + 1} of ${list.length}`}
        </div>
      )}
    </div>
  );
}
