import { useEffect, useState } from "react";
import { makeApi, type BackupSort as Sort, type SortLevel, type SortMatch } from "../api";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { toast } from "./Desktop";
import { baseName } from "../desktop";
import { fmtCount } from "../format";

const many = (n: number, word: string) => `${fmtCount(n)} ${word}${n === 1 ? "" : "s"}`;

const api = makeApi();

export const SORT_LEVELS: readonly (readonly [SortLevel, string])[] = [
  ["program", "Program"], ["year", "Year started"], ["month", "Month started"],
  ["genre", "Genre"], ["folder", "Folder it's kept in"], ["path", "Same folders as your projects"],
];
const NAME: Record<SortLevel, string> = Object.fromEntries(SORT_LEVELS) as Record<SortLevel, string>;
const SLOTS = ["First", "Second", "Third"] as const;
const NO_THANKS = "lc.sortMatch.noThanks";
const KIND: Partial<Record<SortLevel, string>> = { year: "year", month: "month", folder: "folder" };
const byWords = (levels: SortLevel[]) => levels.map((l) => KIND[l] ?? NAME[l].toLowerCase()).join(", then ");

// "2026-10-20_0900" -> "20 Oct 2026, 09:00": the backup's own folder, as people read dates.
export function stampWords(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
  if (!m) return s;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1];
  return `${+m[3]} ${month} ${m[1]}, ${m[4]}:${m[5]}`;
}

/** Up to three levels (Program, Year, Genre…) that sort the backup copies into folders
 *  on the backup drive, a preview path from a real project, and a button that moves
 *  the copies already there to match, with Undo. The producer's own projects never move. */
export function BackupSort({ dest, loaded }: { dest: string; loaded: boolean }) {
  const [saved, setSaved] = useState<SortLevel[] | null>(null);
  const [levels, setLevels] = useState<SortLevel[]>(["program"]);
  const [view, setView] = useState<Sort | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState<"sort" | "undo" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // "Sort like this?": the folders already on the drive (or your project folders) follow a pattern.
  const [match, setMatch] = useState<SortMatch | null>(null);
  const [noThanks, setNoThanks] = useState<string | null>(() => { try { return localStorage.getItem(NO_THANKS); } catch { return null; } });

  useEffect(() => {
    api.backupSort().then((s) => { setSaved(s.levels); setLevels(s.levels); setCanUndo(!!s.undo); })
      .catch(() => setErr("Couldn't load how your backups are sorted."));
  }, []);
  // The preview follows every pick: an example path, and how many backups would move.
  useEffect(() => {
    if (!saved) return;
    let alive = true;
    const t = window.setTimeout(() => {
      api.backupSortPreview(levels).then((v) => { if (alive) setView(v); }).catch(() => {});
    }, 150);
    return () => { alive = false; window.clearTimeout(t); };
  }, [levels, saved, dest]);

  useEffect(() => {
    let alive = true;
    api.backupSortDetect().then((r) => { if (alive) setMatch(r.match); }).catch(() => {});
    return () => { alive = false; };
  }, [dest, saved]);
  function decline() {
    if (!match) return;
    const key = `${dest}|${match.levels.join()}`;
    setNoThanks(key);
    try { localStorage.setItem(NO_THANKS, key); } catch { /* still hidden for now */ }
  }

  const changed = !!saved && saved.join() !== levels.join();
  const offer = match && !changed && saved && saved.join() !== match.levels.join()
    && noThanks !== `${dest}|${match.levels.join()}` ? match : null;
  function pick(slot: number, v: SortLevel | "") {
    setDone(null); setErr(null);
    const next = [...levels];
    if (v === "") next.splice(slot);
    else next[slot] = v;
    setLevels(next.filter((x, i, a) => a.indexOf(x) === i));
  }

  async function apply() {
    setBusy("sort"); setErr(null); setDone(null);
    try {
      const r = await api.setBackupSort(levels);
      setSaved(r.levels); setLevels(r.levels); setCanUndo(r.undo);
      const text = r.moved ? `Sorted. ${many(r.moved, "backup")} moved to match.` : "Saved. New backups go in these folders.";
      // The toast says it worked; the row only keeps what needs reading later.
      setDone(r.failed ? `${many(r.failed, "backup")} couldn't move and stayed where ${r.failed === 1 ? "it was" : "they were"}. The app still finds ${r.failed === 1 ? "it" : "them"}.` : null);
      toast(text, r.undo ? { label: "Undo", onClick: undo } : undefined);
    } catch (e: any) {
      setErr(e.message || "Couldn't sort your backups. Nothing was moved.");
    } finally { setBusy(null); }
  }
  async function undo() {
    setBusy("undo"); setErr(null); setDone(null);
    try {
      const r = await api.undoBackupSort();
      setSaved(r.levels); setLevels(r.levels); setCanUndo(false);
      setDone(r.moved ? `Put back. ${many(r.moved, "backup")} moved back where ${r.moved === 1 ? "it was" : "they were"}.` : "Put back the way it was.");
    } catch (e: any) {
      setErr(e.message || "Couldn't undo that. Your backups are all still there.");
    } finally { setBusy(null); }
  }

  const drive = dest ? baseName(dest) || dest : "Backup drive";
  const ex = view?.example ?? [];
  const path = ex.length ? [drive, ...ex.slice(0, -1), stampWords(ex[ex.length - 1])] : [];
  const off = !loaded || !saved || busy !== null;

  return (
    <div className="bsort">
      {offer && (
        <div className="bsort__match" role="group" aria-label="Sort like the folders already there">
          <Icon name="folder" size={15} className="bsort__icon" />
          <p className="bsort__match-text">
            {offer.where === "backups"
              ? <>The folders already on <bdi>{drive}</bdi> are sorted by {byWords(offer.levels)}.</>
              : <>Your project folders are sorted by {byWords(offer.kinds)}. Put backups in the same folders?</>}{offer.where === "backups" && " Sort backups the same way?"}
          </p>
          <span className="bsort__match-btns">
            <Button size="sm" disabled={off} onClick={() => { setLevels(offer.levels); setDone(null); setErr(null); }}>Sort like this</Button>
            <Button size="sm" variant="quiet" disabled={off} onClick={decline}>No thanks</Button>
          </span>
        </div>
      )}
      <div className="bsort__levels" role="group" aria-label="Sort backups by">
        {SLOTS.map((word, i) => {
          if (i > levels.length || (i > 0 && levels[0] === "path")) return null;
          const here = levels[i] ?? "";
          return (
            <label key={i} className="bsort__level">
              <span className="bsort__word">{word}</span>
              <select value={here} disabled={off} aria-label={`${word} level`}
                onChange={(e) => pick(i, e.target.value as SortLevel | "")}>
                {i > 0 && <option value="">Nothing more</option>}
                {SORT_LEVELS.map(([k, name]) => (
                  <option key={k} value={k} disabled={(k !== here && levels.includes(k)) || (i > 0 && k === "path")}>{name}</option>
                ))}
              </select>
            </label>
          );
        })}
        <span className="bsort__fixed faint">then the project, then the date</span>
      </div>

      {path.length > 0 && (
        <div className="bsort__preview">
          <span className="bsort__eg faint" id="bsort-eg">For example</span>
          <ol className="bsort__tree" aria-labelledby="bsort-eg">
            {path.map((p, i) => (
              <li key={i} className={`bsort__node${i >= path.length - 2 ? " bsort__node--own" : ""}`}
                style={{ paddingInlineStart: `${Math.min(i, 5) * 16}px` }}>
                <Icon name={i === path.length - 1 ? "history" : i === 0 ? "disc" : "folder"} size={13} className="bsort__icon" />
                <bdi>{p}</bdi>
              </li>
            ))}
          </ol>
        </div>
      )}

      {changed ? (
        <div className="bsort__go">
          <p className="set-note">
            {!dest ? "New backups will go in these folders once you choose a backup drive."
              : view && view.moves > 0
                ? <>{many(view.moves, "backup")} already on {drive} will move to match. Only backup copies move; your projects stay where they are. Undo puts them back.</>
                : "New backups go in these folders. Nothing on the drive needs to move."}
          </p>
          <div className="set-inline">
            <Button size="sm" onClick={apply} disabled={off}>
              {busy === "sort" ? "Moving backups…" : view && view.moves > 0 && dest ? `Sort ${many(view.moves, "backup")}` : "Use this sort"}
            </Button>
            <Button size="sm" variant="quiet" disabled={off} onClick={() => { setLevels(saved!); setErr(null); }}>Keep it as it was</Button>
          </div>
        </div>
      ) : (
        <div className="set-inline">
          <p className="set-note">{levels.join() === "program"
            ? "One folder per program, as Backups has always done it."
            : levels[0] === "path" ? "In the same folders as your projects."
            : `Sorted by ${byWords(levels)}.`}</p>
          {canUndo && <Button size="sm" variant="quiet" disabled={off} onClick={undo}>{busy === "undo" ? "Putting back…" : "Undo last sort"}</Button>}
        </div>
      )}
      {done && <p className="set-note set-note--ok" role="status">{done}</p>}
      {err && <p className="set-note set-note--bad" role="alert">{err}</p>}
    </div>
  );
}
