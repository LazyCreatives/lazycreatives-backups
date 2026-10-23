import { useEffect, useState, type KeyboardEvent } from "react";
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
const SLOTS = ["Top folder", "Inside that", "Inside that"] as const;
const KIND: Partial<Record<SortLevel, string>> = { year: "year", month: "month", folder: "folder" };
const byWords = (levels: SortLevel[]) => levels.map((l) => KIND[l] ?? NAME[l].toLowerCase()).join(", then ");

// "2026-10-20_0900" -> "20 Oct 2026, 09:00": the backup's own folder, as people read dates.
export function stampWords(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
  if (!m) return s;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1];
  return `${+m[3]} ${month} ${m[1]}, ${m[4]}:${m[5]}`;
}

// The ready-made sorts, a row of choices above one folder view. "Make my own" opens the levels.
type Choice = { key: string; levels: SortLevel[] | null; title: string };
const CHOICES: Choice[] = [
  { key: "path", levels: ["path"], title: "Like my folders" },
  { key: "program", levels: ["program"], title: "By program" },
  { key: "year-genre", levels: ["year", "genre"], title: "By year, then genre" },
];
const same = (a: SortLevel[] | null | undefined, b: SortLevel[] | null | undefined) => !!a && !!b && a.join() === b.join();
const OWN: Choice = { key: "own", levels: null, title: "My own" };

/** In words, for the Back up screen: "In the same folders as your projects", "By year, then genre". */
export function sortWords(levels: SortLevel[]): string {
  return levels[0] === "path" ? "In the same folders as your projects" : `By ${byWords(levels)}`;
}

// What each choice means, under the folder view's title.
function sentence(levels: SortLevel[]): string {
  if (levels[0] === "path") return "The same folders your projects are kept in, then each project's backups by date.";
  if (levels.join() === "program") return "One folder per music app, as Backups has always done, then each project's backups by date.";
  return `A folder for each ${byWords(levels).replace("folder", "folder you keep projects in")}, then each project's backups by date.`;
}

type Node = { name: string; kids: Node[]; project: boolean };
// "2024/House/Night Drive", "2024/Techno/Glow" -> one tree of folders, projects last.
function treeOf(paths: string[][]): Node[] {
  const top: Node[] = [];
  for (const p of paths) {
    let level = top;
    p.forEach((name, i) => {
      const project = i === p.length - 1;
      let n = level.find((x) => x.name === name && x.project === project);
      if (!n) { n = { name, kids: [], project }; level.push(n); }
      level = n.kids;
    });
  }
  return top;
}

const countLeaves = (nodes: Node[]): number => nodes.reduce((n, x) => n + (x.project ? 1 : countLeaves(x.kids)), 0);

function Rows({ nodes, depth }: { nodes: Node[]; depth: number }) {
  return (
    <>
      {nodes.map((n, i) => (
        <li key={`${n.name}-${i}`} className="bsort__vrow-wrap">
          <span className={`bsort__vrow${n.project ? " bsort__vrow--project" : ""}`} style={{ paddingInlineStart: `${12 + Math.min(depth, 6) * 20}px` }}>
            <Icon name={n.project ? "music" : "folder"} size={14} className="bsort__vicon" />
            <bdi className="bsort__vname" title={n.name}>{n.name}</bdi>
          </span>
          {n.kids.length > 0 && <ol className="bsort__vlist"><Rows nodes={n.kids} depth={depth + 1} /></ol>}
        </li>
      ))}
    </>
  );
}

/** How backup copies are sorted into folders: a row of ready-made choices (or your own
 *  up to three levels) above one big folder view of the backup drive, filled with a few
 *  of your real projects. Before anything moves it lists what moves from where to where;
 *  Undo puts it back. The Second copy keeps the same folders. Your projects never move. */
export function BackupSort({ dest, loaded, second = false }: { dest: string; loaded: boolean; second?: boolean }) {
  const [saved, setSaved] = useState<SortLevel[] | null>(null);
  const [levels, setLevels] = useState<SortLevel[]>(["program"]);
  const [mine, setMine] = useState(false);  // "Make my own" picked: the levels show
  const [view, setView] = useState<Sort | null>(null);
  const [showMoves, setShowMoves] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState<"sort" | "undo" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // How the folders already on the drive (or your project folders) are sorted, when it's clear.
  const [match, setMatch] = useState<SortMatch | null>(null);

  useEffect(() => {
    api.backupSort().then((s) => {
      setSaved(s.levels); setLevels(s.levels); setCanUndo(!!s.undo);
      setMine(!CHOICES.some((c) => same(c.levels, s.levels)));
    }).catch(() => setErr("Couldn't load how your backups are sorted."));
  }, []);
  // The folder view and what would move follow every pick.
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

  // A sort found on the drive that isn't one of the choices gets a choice of its own.
  const found: Choice | null = match && match.where === "backups" && !CHOICES.some((c) => same(c.levels, match.levels))
    ? { key: "found", levels: match.levels, title: "As the drive is now" } : null;
  const choices: Choice[] = [...(found ? [found] : []), ...CHOICES, OWN];
  const on = mine ? "own" : choices.find((c) => same(c.levels, levels))?.key ?? "own";
  const hint = (c: Choice) => match && c.key !== "found" && same(c.levels, match.levels);
  const changed = !!saved && saved.join() !== levels.join();
  const savedTitle = (saved && choices.find((c) => c.levels && same(c.levels, saved))?.title) || "my own sort";

  function choose(c: Choice) {
    setDone(null); setErr(null);
    if (!c.levels) { setMine(true); return; }
    setMine(false); setLevels(c.levels);
  }
  // Like any group of radio buttons: one Tab stop, and the arrow keys move the pick.
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || off) return;
    e.preventDefault();
    const n = (choices.findIndex((c) => c.key === on) + step + choices.length) % choices.length;
    choose(choices[n]);
    (e.currentTarget.children[n] as HTMLElement | undefined)?.focus();
  }
  function pick(slot: number, v: SortLevel | "") {
    setDone(null); setErr(null);
    const next = [...levels];
    if (v === "") next.splice(slot);
    else if (v === "path") next.splice(0, next.length, "path");  // your own folders say everything
    else next[slot] = v;
    setLevels(next.filter((x, i, a) => a.indexOf(x) === i));
  }
  function keep() {
    setLevels(saved!); setErr(null);
    setMine(!choices.some((c) => c.levels && same(c.levels, saved)));
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
      setMine(!CHOICES.some((c) => same(c.levels, r.levels)));
      setDone(r.moved ? `Put back. ${many(r.moved, "backup")} moved back where ${r.moved === 1 ? "it was" : "they were"}.` : "Put back the way it was.");
    } catch (e: any) {
      setErr(e.message || "Couldn't undo that. Your backups are all still there.");
    } finally { setBusy(null); }
  }

  const drive = dest ? baseName(dest) || dest : "Backup drive";
  const off = !loaded || !saved || busy !== null;
  // Until the preview for this pick arrives, don't offer to sort by the last one's numbers.
  const fresh = !!view && view.levels.join() === levels.join();
  const list = view?.move_list ?? [];
  const more = (view?.moves ?? 0) - list.length;
  // When every backup moves out of the same folder, say it once instead of a column of it.
  const oneFrom = list.length > 0 && list.every((m) => m.from.slice(0, -1).join() === list[0].from.slice(0, -1).join())
    ? list[0].from.slice(0, -1).join(" › ") || drive : null;
  const tree = treeOf([...(view?.tree ?? [])].sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000"), undefined, { numeric: true })));


  return (
    <div className="bsort">
      <div className="bsort__choices" role="radiogroup" aria-label="How backups are sorted" onKeyDown={onKey}>
        {choices.map((c) => (
          <button key={c.key} type="button" role="radio" aria-checked={on === c.key} disabled={off} tabIndex={on === c.key ? 0 : -1}
            className={`bsort__choice${on === c.key ? " bsort__choice--on" : ""}`} onClick={() => choose(c)}>
            {on === c.key ? <Icon name="check" size={13} /> : c.key === "own" ? <Icon name="edit" size={13} /> : null}
            {c.title}
            {changed && saved && c.levels && same(c.levels, saved) && <span className="bsort__now bsort__now--use">in use</span>}
            {hint(c) && <span className="bsort__now">{match!.where === "backups" ? "matches the drive" : "matches your projects"}</span>}
          </button>
        ))}
      </div>

      {on === "own" && (
        <div className="bsort__levels" role="group" aria-label="Your own sort">
          {SLOTS.map((word, i) => {
            if (i > levels.length || (i > 0 && levels[0] === "path")) return null;
            const here = levels[i] ?? "";
            return (
              <label key={i} className="bsort__level">
                <span className="bsort__word">{word}</span>
                <select value={here} disabled={off} aria-label={`${word}, ${["first", "second", "third"][i]} folder level`}
                  onChange={(e) => pick(i, e.target.value as SortLevel | "")}>
                  {i > 0 && <option value="">Nothing more</option>}
                  {SORT_LEVELS.map(([k, name]) => (
                    <option key={k} value={k} disabled={(k !== here && levels.includes(k)) || (i > 0 && k === "path")}>{name}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}

      <figure className="bsort__view" aria-label={`How ${drive} will look`}>
        <figcaption className="bsort__vbar">
          <Icon name="nas" size={15} className="bsort__vicon" />
          <bdi className="bsort__vdrive" title={dest || undefined}>{drive}</bdi>
          <span className="bsort__vsay">{sentence(levels)}</span>
          {(view?.projects ?? 0) > tree.length && tree.length > 0 && (
            <span className="bsort__vcount faint">Showing {fmtCount(countLeaves(tree))} of {many(view!.projects!, "project")}</span>
          )}
        </figcaption>
        {tree.length > 0
          ? <ol className="bsort__vlist bsort__vlist--top" tabIndex={0} aria-label={`Folders on ${drive}`}><Rows nodes={tree} depth={0} /></ol>
          : <p className="bsort__vempty faint">Your projects show here once Backups has found them.</p>}
      </figure>

      {changed ? (
        <div className="bsort__go">
          <p className="set-note">
            {!dest ? "New backups will go in these folders once you choose a backup drive."
              : view && view.moves > 0
                ? <>{many(view.moves, "backup")} on <bdi>{drive}</bdi> will move{oneFrom ? <> out of <bdi>{oneFrom}</bdi></> : ""}{second ? ", and the same on your Second copy" : ""}. Only backup copies move; your projects stay where they are.</>
                : "New backups go in these folders. Nothing on the drive needs to move."}
          </p>
          <div className="set-inline">
            <Button size="sm" onClick={apply} disabled={off || (!!dest && !fresh)}>
              {busy === "sort" ? "Moving backups…" : view && view.moves > 0 && dest ? `Sort ${many(view.moves, "backup")}` : "Use this sort"}
            </Button>
            <Button size="sm" variant="quiet" disabled={off} onClick={keep}>Keep {savedTitle.replace(/^(By|Like|As)\b/, (w) => w.toLowerCase())}</Button>
            {dest && list.length > 0 && (
              <Button size="sm" variant="quiet" aria-expanded={showMoves} onClick={() => setShowMoves(!showMoves)}>
                {showMoves ? "Hide what moves" : "See what moves"}
              </Button>
            )}
          </div>
          {dest && showMoves && list.length > 0 && (
            <>
              <div className={`table bsort-moves${oneFrom ? " bsort-moves--to" : ""}`}>
                <div className="row cols cols-head" aria-hidden><span>Project</span>{!oneFrom && <span>From</span>}<span>Moves to</span></div>
                <div role="list" aria-label="What moves">
                  {list.map((m, i) => (
                    <div key={i} className="row cols" role="listitem">
                      <span className="bsort-moves__name" title={`${m.name}, ${stampWords(m.stamp)}`}><bdi className="col-trunc">{m.name}</bdi><span className="faint">{stampWords(m.stamp)}</span></span>
                      {!oneFrom && <span className="faint bsort-moves__path" title={m.from.join(" › ")}><bdi>{m.from.slice(0, -1).join(" › ") || drive}</bdi></span>}
                      <span className="bsort-moves__path" title={m.to.join(" › ")}><bdi>{m.to.slice(0, -1).join(" › ") || drive}</bdi></span>
                    </div>
                  ))}
                </div>
              </div>
              {more > 0 && <p className="set-note faint">and {many(more, "more backup")}.</p>}
            </>
          )}
        </div>
      ) : (
        canUndo && (
          <div className="set-inline">
            <p className="set-note">Your last sort can be put back.</p>
            <Button size="sm" variant="quiet" disabled={off} onClick={undo}>{busy === "undo" ? "Putting back…" : "Undo last sort"}</Button>
          </div>
        )
      )}
      {done && <p className="set-note set-note--ok" role="status">{done}</p>}
      {err && <p className="set-note set-note--bad" role="alert">{err}</p>}
    </div>
  );
}
