import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  addToFolder, deleteFolder, draggedProjects, folderCount, isProjectDrag, makeFolder, MAX_NAME, renameFolder,
  takeOutOfFolder, useFolders, type Folder,
} from "../projectFolders";
import { useDialogFocus } from "./a11y";
import { Cover } from "./Cover";
import { openMenu, toast, toastWarn, useLeave, type MenuItem } from "./Desktop";
import { Icon } from "./Icon";
import { Rolling } from "./Rolling";
import { useLook } from "../look";

// Folders: one slim row of tiles above a list of projects (or of songs, in Uploader), one
// per folder, plus "All" and "New folder". The row scrolls sideways when there are more
// folders than fit, with "All" and "New folder" kept in view at its ends, so the list
// below keeps its room however many folders there are. Click a tile to show only what's in it; drag
// projects onto a tile to add them; right-click a tile to rename or delete it. The
// same box (pickFolders) ticks the folders a project is in, from a row's menu or the
// picked-projects bar. SHARED FILE: the same file lives in Backups and Uploader
// (electron/src/components/ProjectFolders.tsx). Styles are in lazy-ui.css (.fshelf, .fpick),
// in both looks. Nothing here moves or changes a file. A tile that takes a drop holds a
// soft ring for a moment and its count rolls up (Rolling), so the drop is seen where it lands.
// With more than SHOW folders the row shows the first SHOW (plus the open one) and an
// "All folders…" tile that opens a box to find any folder by name, so hundreds of folders
// never make a strip nobody can search, and only a handful of tiles are ever drawn.

export interface ShelfProject { id: string; name: string; genre?: string | null }

const fmtCount = (n: number) => Math.round(n).toLocaleString();
export const SHOW = 8;        // folders shown in the row before "All folders…"
const FIND_MAX = 200;         // rows the "All folders…" box draws before asking for more letters

// The folders the row shows: the first SHOW, plus the open one if it's further down.
export function shownFolders<F extends { id: string }>(folders: F[], open: string | null): F[] {
  if (folders.length <= SHOW) return folders;
  const first = folders.slice(0, SHOW);
  const on = open && !first.some((f) => f.id === open) ? folders.find((f) => f.id === open) : undefined;
  return on ? [...first, on] : first;
}

export function FolderShelf({ projects, open, onOpen, noun = "projects", allLabel = "All projects", count, more: moreItems }: {
  projects: ShelfProject[];               // every project there is (for counts and covers)
  open: string | null;                    // the folder shown, or null for all
  onOpen: (id: string | null) => void;
  noun?: string;                          // what the count counts ("projects", "tracks")
  allLabel?: string;
  count?: (f: Folder | null) => number;   // what to count on a tile (projects there, by default)
  more?: (f: Folder) => MenuItem[];       // extra things a tile's right-click menu offers
}) {
  const folders = useFolders();
  const [look] = useLook();
  const art = look === "sleeve" ? 40 : 28;  // the tile's picture, one cover or four small ones
  const row = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);   // a tile being renamed ("new" = a new one)
  const [took, setTook] = useState<string | null>(null);       // the tile that just took a drop (ring for 2s)
  const [finding, setFinding] = useState(false);               // the "All folders…" box is open
  const tookTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(tookTimer.current), []);
  const ring = (id: string) => {
    window.clearTimeout(tookTimer.current);
    setTook(null);
    requestAnimationFrame(() => setTook(id));  // a second drop on the same tile plays the ring again
    tookTimer.current = window.setTimeout(() => setTook(null), 2000);
  };
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const known = useMemo(() => new Set(byId.keys()), [byId]);
  // the folder that's open is scrolled into view, even when another page opened it
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>(".ftile--on:not(.ftile--all)");
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [open, folders.length]);
  // More folders than fit: the row scrolls sideways (the mouse wheel too), "New folder"
  // shrinks to its "+" and the folders fade out under it instead of showing a scrollbar.
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const check = () => {
      setOverflow(el.scrollWidth > el.clientWidth + 1);
      // keep the open folder (and where scrolling stops) clear of the pinned end tiles,
      // whatever their width (Easier reading makes them wider)
      const pad = (sel: string) => `${(el.querySelector<HTMLElement>(sel)?.offsetWidth ?? 180) + 10}px`;
      const w = (sel: string) => el.querySelector<HTMLElement>(sel)?.offsetWidth ?? 0;
      el.style.setProperty("--fs-pad-l", pad(".ftile--all"));
      // "All folders…" sits pinned just left of "New folder", so both count at the right end
      el.style.setProperty("--fs-new-w", `${w(".ftile--new") || 180}px`);
      el.style.setProperty("--fs-pad-r", `${(w(".ftile--new") || 180) + w(".ftile--more") + (w(".ftile--more") ? 8 : 0) + 10}px`);
    };
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    check();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    const end = el.querySelector<HTMLElement>(".ftile--new");   // it shrinks to its "+" once the row overflows
    if (end) ro?.observe(end);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { ro?.disconnect(); el.removeEventListener("wheel", wheel); };
  }, [folders.length > SHOW, folders.length, naming]);
  const n = (f: Folder | null) => (count ? count(f) : f ? folderCount(f, known) : projects.length);
  const shown = shownFolders(folders, open);
  const hidden = folders.length - shown.length;

  async function dropOn(f: Folder | "new", e: React.DragEvent) {
    e.preventDefault();
    setOver(null);
    const ids = draggedProjects(e.dataTransfer);
    if (!ids.length) return;
    const many = ids.length === 1 ? (byId.get(ids[0])?.name ?? "1 project") : `${ids.length} projects`;
    try {
      if (f === "new") {
        const made = await makeFolder("New folder", ids);
        setNaming(made.id);
        ring(made.id);
        return;
      }
      const fresh = ids.filter((id) => !f.project_ids.includes(id));
      if (!fresh.length) { toast(`${ids.length === 1 ? many + " is" : "They're"} already in ${f.name}.`); return; }
      await addToFolder(f.id, fresh);
      ring(f.id);
      toast(`${many} added to ${f.name}.`, { label: "Undo", onClick: () => { void takeOutOfFolder(f.id, fresh); } });
    } catch {
      toastWarn("Couldn't add to that folder. Try again.");
    }
  }
  const dropProps = (key: string, f: Folder | "new") => ({
    onDragOver: (e: React.DragEvent) => { if (isProjectDrag(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (over !== key) setOver(key); } },
    onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o)); },
    onDrop: (e: React.DragEvent) => { void dropOn(f, e); },
  });

  async function remove(f: Folder) {
    try {
      const undo = await deleteFolder(f.id);
      if (open === f.id) onOpen(null);
      toast(`Folder ${f.name} deleted. Its ${noun} are still in ${allLabel}.`, { label: "Undo", onClick: () => { void undo(); } });
    } catch {
      toastWarn("Couldn't delete that folder. Try again.");
    }
  }
  const menuFor = (f: Folder) => (e: React.MouseEvent) => openMenu(e, [
    { label: "Open", onClick: () => onOpen(f.id) },
    { label: "Rename…", onClick: () => setNaming(f.id) },
    ...(moreItems ? moreItems(f) : []),
    "-",
    { label: "Delete folder", onClick: () => { void remove(f); }, danger: true },
  ]);
  // what a tile does, read when it's used, so tiles don't redraw when only these change
  const act = useRef<TileActs>(null as unknown as TileActs);
  act.current = { click: (f) => onOpen(open === f.id ? null : f.id), menu: (f, e) => menuFor(f)(e), rename: (f) => setNaming(f.id), drop: dropProps };

  return (
    <div className={`fshelf${overflow ? " fshelf--more" : ""}`} role="group" aria-label="Folders" ref={row}>
      <button type="button" className={`ftile ftile--all${open === null ? " ftile--on" : ""}`} aria-pressed={open === null}
        onClick={() => onOpen(null)}>
        <span className="ftile__art" aria-hidden><Icon name="library" size={15} /></span>
        <span className="ftile__text"><span className="ftile__name">{allLabel}</span><span className="ftile__n"><Rolling value={n(null)} /></span></span>
      </button>
      {shown.map((f) => {
        if (naming === f.id) {
          return <NameTile key={f.id} start={f.name} onDone={async (name) => {
            setNaming(null);
            if (name && name !== f.name) await renameFolder(f.id, name).catch(() => toastWarn("Couldn't rename that folder. Try again."));
          }} />;
        }
        const covers = f.project_ids.map((id) => byId.get(id)).filter(Boolean).slice(0, 4) as ShelfProject[];
        return <FolderTile key={f.id} f={f} count={n(f)} covers={covers} art={art} noun={noun}
          on={open === f.id} over={over === f.id} took={took === f.id} act={act} />;
      })}
      {hidden > 0 && (
        <button type="button" className="ftile ftile--more" title={`Find any of your ${fmtCount(folders.length)} folders`}
          aria-haspopup="dialog" onClick={() => setFinding(true)}>
          <span className="ftile__art" aria-hidden><Icon name="search" size={14} /></span>
          <span className="ftile__text"><span className="ftile__name">All folders…</span><span className="ftile__n">{fmtCount(folders.length)}</span></span>
        </button>
      )}
      {naming === "new" ? (
        <NameTile start="" onDone={async (name) => {
          setNaming(null);
          if (!name) return;
          try { onOpen((await makeFolder(name)).id); } catch { toastWarn("Couldn't make that folder. Try again."); }
        }} />
      ) : (
        <button type="button" className={`ftile ftile--new${over === "new" ? " ftile--over" : ""}`}
          title="Make a folder. You can also drag projects here." aria-label="New folder" onClick={() => setNaming("new")} {...dropProps("new", "new")}>
          <span className="ftile__art" aria-hidden><Icon name="plus" size={14} /></span>
          <span className="ftile__text"><span className="ftile__name">New folder</span></span>
        </button>
      )}
      {finding && <FolderFind folders={folders} open={open} n={n} noun={noun}
        onPick={(id) => { setFinding(false); onOpen(id); }} onClose={() => setFinding(false)} />}
    </div>
  );
}

type TileActs = {
  click: (f: Folder) => void;
  menu: (f: Folder, e: React.MouseEvent) => void;
  rename: (f: Folder) => void;
  drop: (key: string, f: Folder) => Partial<React.HTMLAttributes<HTMLElement>>;
};

// One folder's tile. Drawn again only when what it shows changes (its folder, count,
// covers or state), not every time the page above it does.
const FolderTile = memo(function FolderTile({ f, count, covers, art, noun, on, over, took, act }: {
  f: Folder; count: number; covers: ShelfProject[]; art: number; noun: string;
  on: boolean; over: boolean; took: boolean; act: React.MutableRefObject<TileActs>;
}) {
  return (
    <button type="button" aria-pressed={on}
      className={`ftile${on ? " ftile--on" : ""}${over ? " ftile--over" : ""}${took ? " ftile--took" : ""}`}
      title={`${f.name}: ${fmtCount(count)} ${count === 1 ? noun.replace(/s$/, "") : noun}`}
      onClick={() => act.current.click(f)} onContextMenu={(e) => act.current.menu(f, e)}
      onDoubleClick={() => act.current.rename(f)}
      {...act.current.drop(f.id, f)}>
      <span className={`ftile__art ftile__art--${Math.min(covers.length, 4)}`} aria-hidden>
        {covers.length === 0 ? <Icon name="folder" size={15} />
          : covers.map((p) => <Cover key={p.id} name={p.name} genre={p.genre} size={covers.length === 1 ? art : art / 2} label={covers.length === 1} />)}
      </span>
      <span className="ftile__text"><span className="ftile__name">{f.name}</span><span className="ftile__n"><Rolling value={count} /></span></span>
    </button>
  );
}, (a, b) => a.f === b.f && a.count === b.count && a.art === b.art && a.noun === b.noun && a.on === b.on
  && a.over === b.over && a.took === b.took
  && a.covers.length === b.covers.length && a.covers.every((p, i) => p === b.covers[i]));

// "All folders…": find any folder by name and open it.
function FolderFind({ folders, open, n, noun, onPick, onClose: close }: {
  folders: Folder[]; open: string | null; n: (f: Folder) => number; noun: string;
  onPick: (id: string) => void; onClose: () => void;
}) {
  const [leaving, done] = useLeave(close);
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  const [find, setFind] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const words = find.trim().toLowerCase();
  const all = useMemo(() => (words ? folders.filter((f) => f.name.toLowerCase().includes(words)) : folders), [folders, words]);
  const list = all.slice(0, FIND_MAX);
  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={() => done()}>
      <div ref={ref} className="wnew confirm fpick" role="dialog" aria-modal="true" aria-labelledby="ffind-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="fpick__head">
          <div className="eyebrow">{fmtCount(folders.length)} folders</div>
          <h2 id="ffind-title">All folders</h2>
        </div>
        <label className="fpick__find">
          <Icon name="search" size={14} />
          <input type="search" value={find} placeholder="Find a folder" aria-label="Find a folder" autoFocus
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && list.length) { e.preventDefault(); onPick(list[0].id); } }} />
        </label>
        <div className="fpick__list" role="list" aria-label="Folders">
          {list.map((f) => {
            const c = n(f);
            return (
              <button type="button" role="listitem" key={f.id} className={`fpick__row fpick__row--go${open === f.id ? " fpick__row--on" : ""}`}
                aria-current={open === f.id || undefined} title={f.name} onClick={() => onPick(f.id)}>
                <Icon name="folder" size={15} />
                <span className="fpick__name col-trunc">{f.name}</span>
                <span className="fpick__n" aria-label={`${fmtCount(c)} ${c === 1 ? noun.replace(/s$/, "") : noun}`}>{fmtCount(c)}</span>
              </button>
            );
          })}
          {all.length > list.length && <p className="fpick__empty">{fmtCount(all.length - list.length)} more. Type to narrow it down.</p>}
          {all.length === 0 && <p className="fpick__empty">No folder called that.</p>}
        </div>
        <div className="confirm__foot">
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={() => done()}>Close</button>
        </div>
      </div>
    </div>
  );
}

// A tile with a name box in it: Enter or clicking away keeps the name, Escape doesn't.
function NameTile({ start, onDone }: { start: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(start);
  const done = useRef(false);
  const finish = (name: string | null) => { if (done.current) return; done.current = true; onDone(name); };
  return (
    <span className="ftile ftile--naming">
      <span className="ftile__art" aria-hidden><Icon name="folder" size={15} /></span>
      <input className="ftile__input" value={v} maxLength={MAX_NAME} autoFocus placeholder="Folder name"
        aria-label="Folder name" spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => finish(v.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); finish(v.trim() || null); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
        }} />
    </span>
  );
}

// ── "Add to folder…": tick the folders some projects are in ────────────────────

type PickState = { title: string; ids: string[]; resolve: () => void } | null;
const pickSubs = new Set<(s: PickState) => void>();

// Opens the box for these projects; resolves when it closes.
export function pickFolders(title: string, ids: string[]): Promise<void> {
  if (!pickSubs.size || !ids.length) return Promise.resolve();
  return new Promise((resolve) => pickSubs.forEach((f) => f({ title, ids, resolve })));
}

// Rendered once in the app; shows the box when something asks for it.
export function FolderPickHost() {
  const [s, setS] = useState<PickState>(null);
  useEffect(() => { pickSubs.add(setS); return () => { pickSubs.delete(setS); }; }, []);
  if (!s) return null;
  return <FolderBox key={s.ids.join()} s={s} done={() => { s.resolve(); setS(null); }} />;
}

function FolderBox({ s, done: close }: { s: NonNullable<PickState>; done: () => void }) {
  const [leaving, done] = useLeave(close);
  const folders = useFolders();
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  // what each folder holds of these projects now: all, some or none
  type Tick = boolean | "some";
  const has = (f: Folder) => s.ids.filter((id) => f.project_ids.includes(id)).length;
  const was = (f: Folder): Tick => (has(f) === s.ids.length ? true : has(f) ? "some" : false);
  const [ticks, setTicks] = useState<Record<string, Tick>>(() => Object.fromEntries(folders.map((f) => [f.id, was(f)])));
  const tickOf = (f: Folder): Tick => (f.id in ticks ? ticks[f.id] : was(f));
  const [made, setMade] = useState("");
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState("");
  const many = s.ids.length > 1;
  const list = find.trim() ? folders.filter((f) => f.name.toLowerCase().includes(find.trim().toLowerCase())) : folders;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const changes = folders.filter((f) => tickOf(f) !== was(f));
  async function save() {
    setBusy(true);
    try {
      for (const f of changes) {
        if (tickOf(f) === true) await addToFolder(f.id, s.ids.filter((id) => !f.project_ids.includes(id)));
        else await takeOutOfFolder(f.id, s.ids);
      }
      if (made.trim()) await makeFolder(made, s.ids);
      const n = changes.length + (made.trim() ? 1 : 0);
      if (n) toast(`${many ? `${s.ids.length} projects` : s.title}: folders saved.`);
      done();
    } catch {
      toastWarn("Couldn't save the folders. Try again.");
      setBusy(false);
    }
  }
  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={() => done()}>
      <div ref={ref} className="wnew confirm fpick" role="dialog" aria-modal="true" aria-labelledby="fpick-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="fpick__head">
          <div className="eyebrow">{many ? `${fmtCount(s.ids.length)} projects` : "Folders"}</div>
          <h2 id="fpick-title" className="col-trunc" title={s.title}>{many ? "Add to folders" : s.title}</h2>
          <p className="fpick__now">Tick every folder {many ? "they belong" : "it belongs"} in. Your files stay where they are.</p>
        </div>
        {folders.length > 8 && (
          <label className="fpick__find">
            <Icon name="search" size={14} />
            <input type="search" value={find} placeholder="Find a folder" aria-label="Find a folder" onChange={(e) => setFind(e.target.value)} />
          </label>
        )}
        {folders.length > 0 && (
          <div className="fpick__list" role="group" aria-label="Folders">
            {list.map((f) => {
              const t = tickOf(f);
              const some = t === "some";
              return (
                <label key={f.id} className="fpick__row">
                  <input type="checkbox" checked={t === true} ref={(el) => { if (el) el.indeterminate = some; }}
                    onChange={() => setTicks((all) => ({ ...all, [f.id]: t === true ? false : true }))} />
                  <Icon name="folder" size={15} />
                  <span className="fpick__name col-trunc" title={f.name}>{f.name}</span>
                  <span className="fpick__n">{some ? `${fmtCount(has(f))} of ${fmtCount(s.ids.length)} in it` : fmtCount(f.project_ids.length)}</span>
                </label>
              );
            })}
            {list.length === 0 && <p className="fpick__empty">No folder called that.</p>}
          </div>
        )}
        <label className="fpick__new">
          <Icon name="plus" size={14} />
          <input type="text" value={made} maxLength={MAX_NAME} placeholder={folders.length ? "Or make a new folder" : "Name your first folder"}
            aria-label="New folder name" autoFocus={!folders.length} spellCheck={false}
            onChange={(e) => setMade(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} />
        </label>
        <div className="confirm__foot">
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={() => done()}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={busy || (!changes.length && !made.trim())} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>
  );
}
