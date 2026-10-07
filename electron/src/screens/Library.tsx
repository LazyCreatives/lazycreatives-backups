import { useEffect, useMemo, useRef, useState } from "react";
import { pickCover } from "../components/CoverPick";
import { makeApi } from "../api";
import type { LibraryItem } from "../types";
import type { ScanProgress } from "../useProgress";
import { Button } from "../components/Button";
import { ProgressBar } from "../components/ProgressBar";
import { fmtSize, fmtDate, dawLabel, fmtDay, fmtCount, fmtCap } from "../format";
import { ProjectBackups } from "./ProjectBackups";
import { ProjectLabel } from "./ProjectLabel";
import { ProjectExports } from "./ProjectExports";
import { AuditionDiv, PlayButton, SongWave } from "../components/Player";
import { AuditionToggle } from "../components/Audition";
import { MissingSamples } from "./MissingSamples";
import { currentOs, osWords } from "../platform";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { genreColor, useLook } from "../look";
import { Rating, RowSize, ratingMenu } from "../components/Marks";
import { ratingOf, renameRatings, useDensity, useRatings } from "../marks";
import { pickGenre, pickCrateColor } from "../components/GenrePick";
import { PageHeader } from "../components/PageHeader";
import { UnmatchedSongs } from "./UnmatchedSongs";
import { SmartBar } from "../components/SmartBar";
import { ColumnBrowse, FacetChips, NO_GENRE, facets } from "../components/Browse";
import { BPM_BANDS, FIRST_DIR, NO_FILTERS, applyFilters, describeFilters, yearOf, rememberSort, rememberedSort, sortItems, type LibSort, type SortKey, extraFilterCount, isFiltered, countStatuses, statusSummary, rememberFilters, rememberedFilters, type LibFilters, type LibraryView, type StatusFilter, viewFor } from "../libraryFilter";
import { openMenu, toast, type MenuItem, toastWarn } from "../components/Desktop";
import { copyText, keep, recall } from "../desktop";
import { pinnedFirst, renamePins, setPins, togglePin, usePins } from "../pins";
import { renameRecents } from "../recents";
import { NoteOpened } from "../components/Recents";
import { TidyNames } from "./TidyNames";
import type { TidyBatch, TidyDone } from "../types";
import { EmptyState } from "../components/SlothSpot";
import { rowKey } from "../components/a11y";
import { backupAndWait, type RunResult } from "../runBackup";
import "../library.css";

const api = makeApi();

function fmtEta(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "";
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Scan reach — mirrors the backend scopes. "My folders" = the configured sources.
const SCOPES: { key: string; label: string }[] = [
  { key: "sources", label: "My folders" },
  { key: "home", label: `My whole ${osWords().computer}` },
  { key: "volumes", label: "+ External drives" },
];
const IS_MAC = currentOs() === "mac";

const DAW_NAMES: Record<string, string> = {
  ableton: "Ableton", flstudio: "FL Studio", reaper: "Reaper", dawproject: "DAWproject", audacity: "Audacity",
  logic: "Logic Pro", studioone: "Studio One", bitwig: "Bitwig",
};

function ownerLabel(owner: string): string {
  if (owner === "system") return "Other / system";
  return owner;
}

const bridge = () => (window as any).ablebackup;
const openInDaw = (p?: string) => { if (p) bridge()?.openProject?.(p); };
const revealPath = (p?: string) => { if (p) bridge()?.revealPath?.(p); };

// One plain line that says the truth about a project: missing samples beat
// "backed up", because a verified backup of a project with holes still needs you.
// One row of the library table: the status column in plain words, then the last
// backup date and the size on disk in their own columns so every row lines up.
function statusLine(it: LibraryItem): { tone: "ok" | "warn" | "changed" | "none"; text: string; when: string; size: string } {
  const size = fmtSize(it.size);
  if (it.missing_count > 0) {
    const n = it.missing_count;
    // the status cell is narrow: big counts drop the word "samples" (the tooltip has it all)
    return { tone: "warn", text: n < 100 ? `${n} sample${n === 1 ? "" : "s"} missing` : `${fmtCap(n)} missing`, when: it.backed_up ? fmtDate(it.last_backup) : "not backed up", size };
  }
  if (it.changed) return { tone: "changed", text: "Changed", when: fmtDate(it.last_backup), size };
  if (it.backed_up) return { tone: "ok", text: "Verified", when: fmtDate(it.last_backup), size };
  return { tone: "none", text: "Not backed up yet", when: "—", size };
}

// The "···" menu on a row: the less common actions, out of the way.
// From the keyboard: Enter/Space on ··· opens it with the first item focused, Up/Down
// move, Home/End jump, Escape or Tab closes it and focus goes back to the ··· button.
function RowMenu({ items, name }: { items: { label: string; onClick: () => void; disabled?: boolean }[]; name: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) btnRef.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("mousedown", onDown); };
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "Tab") { close(false); return; }
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!btns.length) return;
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % btns.length
      : e.key === "ArrowUp" ? (at - 1 + btns.length) % btns.length
      : e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault(); e.stopPropagation();
    btns[next].focus();
  };
  return (
    <div ref={ref} className={`lib-menu${open ? " lib-menu--open" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} className="iconbtn" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}><Icon name="more" /></button>
      {open && (
        <div ref={listRef} className="lib-menu__list" role="menu" aria-label={`More actions for ${name}`} onKeyDown={onKey}>
          {items.map((m) => (
            <button key={m.label} role="menuitem" className="lib-menu__item" disabled={m.disabled}
              onClick={() => { close(true); m.onClick(); }}>{m.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Which owner groups are folded shut, kept while the app is open so the list looks
// the same when you come back to it.
let rememberedCollapsed: Record<string, boolean> = {};
// The scan reach is saved for the next time the app opens too.
let rememberedScope = recall("lc-library-scope", "home", (v) => SCOPES.some((s) => s.key === v));

// openProject: the project shown as its own page (its id, or its name when another
// screen opened it), or null for the list. Opening and closing go through the app's
// back/forward history, so the side mouse buttons step between list and project.
export function Library({ scan, openProject, onOpen, onClose, scanOnOpen = false, onScanStarted, show = null, onShown }: {
  scan: ScanProgress; openProject?: string | null;
  onOpen: (projectId: string) => void; onClose: () => void;
  scanOnOpen?: boolean; onScanStarted?: () => void;  // first run: find projects straight away
  show?: LibraryView | null; onShown?: () => void;   // another screen asked for this view
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  // songs in exports folders no project matched, and whether that list is open
  const [unmatched, setUnmatched] = useState(0);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scope, setScopeState] = useState(rememberedScope);
  const setScope = (v: string) => { rememberedScope = v; keep("lc-library-scope", v); setScopeState(v); };
  const [scanning, setScanning] = useState(false);
  const [fdaOk, setFdaOk] = useState(true);
  const [skipped, setSkipped] = useState(0);     // dirs the last scan couldn't read
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsedState] = useState<Record<string, boolean>>(() => rememberedCollapsed);
  const setCollapsed = (f: (c: Record<string, boolean>) => Record<string, boolean>) =>
    setCollapsedState((c) => (rememberedCollapsed = f(c)));
  const [err, setErr] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);  // the library itself couldn't be read
  // why the last one-project backup from a row didn't work, by project id
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [filters, setFiltersState] = useState<LibFilters>(rememberedFilters);
  const [sort, setSortState] = useState<LibSort | null>(rememberedSort);
  // click a heading to sort by it, click it again to flip the order
  const sortBy = (key: SortKey) => setSortState((cur) => {
    const n: LibSort = cur?.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: FIRST_DIR[key] };
    rememberSort(n); return n;
  });
  const setFilters = (patch: Partial<LibFilters> | null) => {
    setFiltersState((f) => { const n = patch ? { ...f, ...patch } : NO_FILTERS; rememberFilters(n); return n; });
  };
  const [look] = useLook();
  const [rows, setRows] = useDensity("library");
  // Crate: the usual list, or Genre > Year > Project columns
  const [view, setViewState] = useState<"list" | "columns">(() => recall("lc-library-view", "list", (v) => v === "list" || v === "columns"));
  const setView = (v: "list" | "columns") => { keep("lc-library-view", v); setViewState(v); };
  useRatings();  // redraw (and re-sort) when a rating changes
  const [fixingAll, setFixingAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);  // one-line result of "Find missing samples"
  const lastOpen = useRef<string | null>(null);  // the project page shown last, to un-fold its group
  // "Tidy names": the projects whose names are being tidied (the window is open)
  const [tidyFor, setTidyFor] = useState<LibraryItem[] | null>(null);
  const [tidyTick, setTidyTick] = useState(0);  // bumps after a rename or undo

  function load() {
    return api.library().then((r) => { setItems(r.projects); setUnmatched(r.unmatched_songs ?? 0); setLoadFailed(false); })
      .catch(() => setLoadFailed(true)).finally(() => setLoading(false));
  }

  // After a rename (or its undo) each project has a new id, which comes from where its
  // file is: carry pins and the open page over to it.
  async function afterRename(idMap: Record<string, string>) {
    renamePins(idMap);
    renameRecents(idMap);
    renameRatings(idMap);
    setPicked(new Set());
    await load();
    setTidyTick((t) => t + 1);
    if (openProject && idMap[openProject]) onOpen(idMap[openProject]);
  }
  async function tidyDone(r: TidyDone) {
    setTidyFor(null);
    await afterRename(r.id_map);
  }
  useEffect(() => { load(); }, []);

  // Correct the genre of one project (or every ticked one). Covers, stripes and Dig
  // crates follow it, and so does Uploader, which reads the same record.
  async function changeGenre(list: LibraryItem[]) {
    if (!list.length) return;
    const one = list[0];
    const byYou = list.every((i) => !!i.genre_by_you);
    const same = list.every((i) => (i.genre || null) === (one.genre || null));
    const pick = await pickGenre({
      title: list.length === 1 ? one.name : `${list.length} projects`,
      cover: one.name, count: list.length,
      current: same ? one.genre || null : null,
      setByYou: same && byYou,
      guess: list.length === 1 ? one.genre_guess ?? null : undefined,
      why: one.bpm ? `from its tempo (${Math.round(one.bpm)} BPM) and name` : "from its name",
      note: "Covers, colours and Dig crates follow your pick, and so does Uploader. A new scan won't change it, and similar projects learn from it.",
      yours: items.filter((i) => i.genre_by_you && i.genre).map((i) => i.genre!),
    });
    if (pick === undefined) return;
    const before = list.map((i) => ({ id: i.project_id, genre: i.genre_by_you ? i.genre || null : null }));
    try {
      const res = await api.setGenre(list.map((i) => i.project_id), pick);
      load();
      const what = list.length === 1 ? one.name : `${list.length} projects`;
      const also = res.relearned ? ` ${res.relearned} similar project${res.relearned === 1 ? "" : "s"} re-guessed too.` : "";
      toast((pick ? `${what} is now ${pick}.` : `${what} is back to the guess.`) + also, {
        label: "Undo",
        onClick: async () => {
          for (const b of before) await api.setGenre([b.id], b.genre).catch(() => {});
          load();
        },
      });
    } catch {
      toastWarn("Couldn't change the genre. Try again.");
    }
  }
  // Another screen sent us here to see something ("See what we gathered", "3 safe"):
  // show exactly that, from the top, with fresh numbers. Works when already here too.
  useEffect(() => {
    if (!show) return;
    onShown?.();
    const v = viewFor(show, sort);
    setFilters(v.filters);
    if (v.sort !== sort) { rememberSort(v.sort); setSortState(v.sort); }
    setCollapsed(() => ({}));
    document.querySelector(".main")?.scrollTo({ top: 0 });
    load();
  }, [show]);
  useEffect(() => {
    if (!scanOnOpen) return;
    onScanStarted?.();
    runScan("sources");
  }, [scanOnOpen]);

  // Coming back from a project: make sure its owner group is open so its row shows.
  useEffect(() => {
    if (openProject || !lastOpen.current) return;
    const hit = items.find((i) => i.project_id === lastOpen.current);
    if (hit && collapsed[hit.owner || "system"]) setCollapsed((c) => ({ ...c, [hit.owner || "system"]: false }));
  }, [openProject, items]);

  async function runScan(where: string = scope) {
    setScanning(true); setErr(null);
    try {
      // scanMac handles every scope incl. "sources"; returns skipped-dir count + FDA.
      const r = await api.scanMac(where, true);
      setSkipped(r.skipped_dirs || 0);
      setFdaOk(r.full_disk_access);
      load();
    } catch (e: any) { setErr(e.message || "Scan failed."); }
    finally { setScanning(false); }
  }

  // Back up one project (searching for missing samples too). If it doesn't work the
  // row says so and a message explains why, with a way to try again.
  async function backupOne(item: LibraryItem, extraLib?: string): Promise<RunResult> {
    setBusy((s) => new Set(s).add(item.project_id)); setErr(null);
    setRowErr((m) => { if (!(item.project_id in m)) return m; const n = { ...m }; delete n[item.project_id]; return n; });
    const res = await backupAndWait({
      als_paths: [item.path], portable: true, layout: "project_date", find_missing: true,
      libraries: extraLib ? [extraLib] : undefined,
    });
    setBusy((s) => { const n = new Set(s); n.delete(item.project_id); return n; });
    if (!res.ok) {
      setRowErr((m) => ({ ...m, [item.project_id]: res.reason }));
      toastWarn(`${item.name} couldn't be backed up. ${res.reason}`, { label: "Try again", onClick: () => { backupOne(item, extraLib); } });
    }
    await load();
    return res;
  }

  // "Find missing samples" on a row: search the sample folders and back it up; if some
  // are still missing, offer the project page where you can point to them.
  async function findSamples(item: LibraryItem, extraLib?: string) {
    const res = await backupOne(item, extraLib);
    if (!res.ok) return;
    const r = await api.library().catch(() => null);
    const now = r?.projects.find((i) => i.project_id === item.project_id);
    if (now && now.missing_count > 0) {
      const found = item.missing_count - now.missing_count;
      toast(found > 0
        ? `Found ${found} of ${item.missing_count} in ${item.name}. ${now.missing_count} still missing.`
        : `None of ${item.name}'s ${item.missing_count} missing sample${item.missing_count === 1 ? "" : "s"} turned up in your folders.`,
        { label: "Point me to them", onClick: () => onOpen(item.project_id) });
    } else if (now) {
      toast(`Found every missing sample in ${item.name} and backed it up.`);
    }
  }

  // Back up several projects in one run (the changed ones, or the ticked ones).
  const [changedBusy, setChangedBusy] = useState(false);
  const backupChanged = () => backupMany(items.filter((i) => i.changed && i.missing_count === 0));
  async function backupMany(targets: LibraryItem[]) {
    if (!targets.length) return;
    setChangedBusy(true); setErr(null);
    setBusy((s) => new Set([...s, ...targets.map((t) => t.project_id)]));
    const res = await backupAndWait({
      als_paths: targets.map((t) => t.path), portable: true, layout: "project_date", find_missing: true,
    });
    setBusy((s) => { const n = new Set(s); targets.forEach((t) => n.delete(t.project_id)); return n; });
    setChangedBusy(false);
    if (!res.ok) {
      const byName = new Map(res.failed.map((f) => [f.project_name, f.reason]));
      const failed = targets.filter((t) => byName.has(t.name));
      setRowErr((m) => { const n = { ...m }; failed.forEach((t) => { n[t.project_id] = byName.get(t.name)!; }); return n; });
      const again = failed.length ? failed : targets;
      toastWarn(failed.length
        ? `${failed.length} of ${targets.length} couldn't be backed up. ${res.reason}`
        : `The backup didn't finish. ${res.reason}`,
        { label: "Try again", onClick: () => { backupMany(again); } });
    }
    load();
  }

  // Point the finder at a folder you think this project's samples are in.
  async function lookInFolder(item: LibraryItem) {
    const dir = await bridge()?.pickFolder?.();
    if (dir) findSamples(item, dir);
  }

  // Fix everything at once: one backup pass over every project with missing samples,
  // auto-finding from your libraries + sources.
  async function fixAll() {
    const targets = items.filter((i) => i.missing_count > 0);
    if (targets.length === 0) return;
    setFixingAll(true); setErr(null); setNotice(null);
    const before = targets.reduce((n, t) => n + t.missing_count, 0);
    try {
      const res = await backupAndWait({
        als_paths: targets.map((t) => t.path), portable: true, layout: "project_date", find_missing: true,
      }, 1500);
      if (!res.ok && !res.failed.length) {
        toastWarn(`Couldn't look for the missing samples. ${res.reason}`, { label: "Try again", onClick: () => { fixAll(); } });
      }
      const r = await api.library();
      setItems(r.projects);
      const after = r.projects.reduce((n, t) => n + t.missing_count, 0);
      const found = before - after;
      setNotice(found > 0
        ? `Found ${found} of ${before} missing sample${before === 1 ? "" : "s"}.${after > 0 ? ` ${after} still missing — open a project and point me to them.` : ""}`
        : `None of the ${before} missing sample${before === 1 ? "" : "s"} turned up in your folders — open a project and point me to them.`);
    } catch { setErr("Couldn't read your library after the search. Restart the app; your projects are untouched."); }
    finally { setFixingAll(false); }
  }

  const attentionCount = items.filter((i) => i.missing_count > 0).length;
  const changedItems = items.filter((i) => i.changed && i.missing_count === 0);
  const pins = usePins();
  const rated = items.map((i) => ratingOf(i.project_id)).join();
  const shown = useMemo(() => pinnedFirst(sortItems(applyFilters(items, filters), sort), pins), [items, filters, sort, pins, rated]);
  // Ticked projects, for doing one thing to several at once.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickedItems = items.filter((i) => picked.has(i.project_id));
  const picking = picked.size > 0;
  // the status buttons count what the other filters leave, so the numbers add up
  const statusCounts = useMemo(() => {
    return countStatuses(applyFilters(items, filters, true));
  }, [items, filters]);
  const allCounts = useMemo(() => countStatuses(items), [items]);
  const dawOptions = useMemo(() => [...new Set(items.map((i) => i.daw || "").filter(Boolean))].sort(), [items]);
  const genreOptions = useMemo(() => [...new Set(items.map((i) => i.genre || "").filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const yearOptions = useMemo(() => [...new Set(items.map(yearOf).filter(Boolean))].sort().reverse(), [items]);
  const anyRated = rated.replace(/[0,]/g, "") !== "";
  // Genre and Year to browse by, counted over what the other filters leave
  const browse = useMemo(() => {
    const pool = applyFilters(items, { ...filters, genre: "", year: "" });
    const inGenre = filters.genre ? applyFilters(pool, { ...NO_FILTERS, genre: filters.genre }).length : pool.length;
    return { ...facets(pool, (i) => i.genre, yearOf, filters.genre), total: pool.length, inGenre };
  }, [items, filters, rated]);
  const columns = look === "crate" && view === "columns";
  const filtered = isFiltered(filters);
  // only "Missing samples" picked and nothing left: that's good news, not a failed search
  const onlyMissing = filters.status === "missing" && extraFilterCount(filters) === 0 && !filters.q.trim();
  // With no songs anywhere yet, the song column shrinks so the rest has room.
  const colsClass = items.some((i) => i.latest_export) ? "lib-cols" : "lib-cols lib-cols--nosongs";
  const byOwner = useMemo(() => {
    const m: Record<string, LibraryItem[]> = {};
    for (const it of shown) (m[it.owner || "system"] ||= []).push(it);
    return m;
  }, [shown]);
  const owners = useMemo(() => Object.keys(byOwner).sort(), [byOwner]);

  // ETA from the parse rate (updates each project tick).
  const elapsed = scan.startedAt ? (Date.now() - scan.startedAt) / 1000 : 0;
  const eta = scan.phase === "parsing" && scan.done > 0 && scan.total > scan.done
    ? fmtEta((elapsed / scan.done) * (scan.total - scan.done)) : "";
  const showProgress = scanning || scan.active;

  // ── project page: replaces the list, with a way back ──
  const openItem = openProject
    ? items.find((i) => i.project_id === openProject) ?? items.find((i) => i.name === openProject) ?? null
    : null;
  if (openItem) lastOpen.current = openItem.project_id;
  if (openProject && loading) return <div className="empty">Loading your library…</div>;
  if (openItem) {
    const it = openItem;
    return (
      <>
        <NoteOpened id={it.project_id} name={it.name} cover={it.name} genre={it.genre} />
        <button className="lib-back" onClick={onClose}><Icon name="arrowLeft" size={14} />Library</button>
        <TidyUndo projectId={it.project_id} tick={tidyTick} onUndone={afterRename} />
        <ProjectLabel item={it}
          onGenre={() => changeGenre([it])}
          onOpenInDaw={() => openInDaw(it.path)}
          onReveal={() => revealPath(it.path)}
          actions={<>
            <Button variant="ghost" onClick={() => setTidyFor([it])}
              title="Give this song's versions, folder and exported songs matching names">
              <Icon name="edit" size={15} />Tidy names
            </Button>
            {(!it.backed_up || it.changed) && (
              <Button disabled={busy.has(it.project_id)} onClick={() => backupOne(it)}>
                {busy.has(it.project_id) ? "Backing up…" : "Back up now"}
              </Button>
            )}
          </>}
          tabs={[
            // missing samples first: it's the thing that needs a decision
            ...(it.missing_count > 0 ? [{ key: "missing", label: "Missing samples", count: it.missing_count,
              content: <MissingSamples item={it} onChanged={load} /> }] : []),
            { key: "songs", label: "Songs", content: <ProjectExports item={it} onChanged={load} /> },
            { key: "backups", label: "Backups", count: it.snapshot_count, content: it.backed_up
              ? <ProjectBackups projectName={it.name} projectPath={it.path} onFixed={load} />
              : <EmptyState pose="napping" title="No backups of this project yet" say="Nothing to guard yet.">Press Back up now at the top and the first one shows here.</EmptyState> },
          ]} />
        {tidyFor && <TidyNames items={tidyFor} onClose={() => setTidyFor(null)} onDone={tidyDone} />}
      </>
    );
  }

  if (showUnmatched) {
    return <UnmatchedSongs items={items} onBack={() => { setShowUnmatched(false); load(); }} onChanged={load} />;
  }

  return (
    <>
      <PageHeader title="Library"
        subtitle={items.length === 0 ? "Click a project for its details and backups."
          : <>{fmtCount(items.length)} project{items.length === 1 ? "" : "s"}: {statusSummary(allCounts)}. Click one for its details and backups.</>}
        actions={attentionCount > 0 || changedItems.length > 0 ? (
          <>
            {changedItems.length > 0 && (
              <Button variant={attentionCount > 0 ? "ghost" : undefined} onClick={backupChanged} disabled={changedBusy}
                title="Back up the projects you've saved since their last backup">
                {changedBusy ? "Backing up…" : `Back up the ${changedItems.length} changed`}
              </Button>
            )}
            {attentionCount > 0 && (
              <Button onClick={fixAll} disabled={fixingAll}
                title="Back up every project with missing samples, searching your sample folders for them">
                {fixingAll ? "Looking for samples…" : `Find missing samples (${attentionCount})`}
              </Button>
            )}
          </>
        ) : undefined} />

      <div className="lib-scan">
        <span className="faint" style={{ fontSize: 12.5 }}>Look for projects in</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={scanning} aria-label="Look for projects in">
          {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <Button variant="ghost" size="sm" onClick={() => runScan()} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan now"}
        </Button>
        {showProgress && (
          <div style={{ flexBasis: "100%", marginTop: 4 }}>
            {scan.phase === "searching" || (!scan.phase && scanning) ? (
              <>
                <div className="sub" style={{ margin: "0 0 6px", fontSize: 12.5 }}>
                  Searching… {scan.dirs.toLocaleString()} folders · {scan.found} project{scan.found === 1 ? "" : "s"} found
                </div>
                <ProgressBar value={1} max={1} active />
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="sub" style={{ margin: 0, fontSize: 12.5 }}>Reading projects…</span>
                  <span className="sub mono" style={{ margin: 0, fontSize: 12.5 }}>
                    {scan.done}/{scan.total}{eta ? ` · ~${eta} left` : ""}
                  </span>
                </div>
                <ProgressBar value={scan.done} max={scan.total} active />
                {scan.current && (
                  <div className="sub" style={{ margin: "6px 0 0", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scan.current}</div>
                )}
              </>
            )}
          </div>
        )}
        {(skipped > 0 || !fdaOk) && !scanning && (
          <div className="locked-note" style={{ flexBasis: "100%", flexDirection: "column", alignItems: "stretch", gap: 9 }}>
            <div style={{ fontSize: 12.5 }}>
              {IS_MAC ? (
                <>Skipped {skipped > 0 ? skipped.toLocaleString() + " " : ""}folder{skipped === 1 ? "" : "s"} that macOS hides
                (Documents / Desktop / Downloads) until you grant this app Full Disk Access.</>
              ) : (
                <>Skipped {skipped.toLocaleString()} folder{skipped === 1 ? "" : "s"} this app isn't allowed to open.
                Projects inside {skipped === 1 ? "it" : "them"} weren't scanned.</>
              )}
            </div>
            {IS_MAC && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button variant="ghost" size="sm" onClick={() => (window as any).ablebackup?.openFdaSettings?.()}>
                  Grant Full Disk Access
                </Button>
              </div>
            )}
          </div>
        )}
        {err && <div className="sub" style={{ color: "var(--danger)", flexBasis: "100%", margin: 0, fontSize: 12 }}>{err}</div>}
      </div>

      {!loading && items.length > 0 && (
        <div className="lib-find">
          <div className="lib-find__top">
            <label className="lib-search">
              <Icon name="search" size={15} />
              <input type="search" placeholder="Search projects, genres, songs…" value={filters.q}
                aria-label="Search projects" spellCheck={false} data-find
                onChange={(e) => setFilters({ q: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Escape") setFilters({ q: "" }); }} />
              {filters.q && <button className="lib-search__x" aria-label="Clear search" onClick={() => setFilters({ q: "" })}><Icon name="close" size={13} /></button>}
            </label>
            <div className="seg" role="group" aria-label="Backup state">
              {([["all", "All"], ["safe", "Safe"], ["changed", "Changed"], ["missing", "Missing samples"], ["none", "Not backed up"]] as [StatusFilter, string][]).map(([k, label]) => (
                <button key={k} className={`seg__opt${filters.status === k ? " seg__opt--on" : ""}`} onClick={() => setFilters({ status: k })}>
                  {label} <span className="lib-find__n">{fmtCount(statusCounts[k])}</span>
                </button>
              ))}
            </div>
            {look === "crate" && (
              <div className="lib-find__view">
                {!columns && <RowSize value={rows} onChange={setRows} />}
                <div className="seg seg--icons" role="radiogroup" aria-label="Show as">
                  {([["list", "library", "List"], ["columns", "columns", "Genre, year, project columns"]] as const).map(([k, icon, label]) => (
                    <button key={k} type="button" role="radio" aria-checked={view === k} title={label} aria-label={label}
                      className={`seg__opt${view === k ? " seg__opt--on" : ""}`} onClick={() => setView(k)}><Icon name={icon} size={14} /></button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="lib-find__row">
            {dawOptions.length > 1 && (
              <select className={filters.daw ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.daw} aria-label="DAW" onChange={(e) => setFilters({ daw: e.target.value })}>
                <option value="">Any DAW</option>
                {dawOptions.map((d) => <option key={d} value={d}>{DAW_NAMES[d] || d}</option>)}
              </select>
            )}
            {genreOptions.length > 0 && (
              <select className={filters.genre ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.genre} aria-label="Genre" onChange={(e) => setFilters({ genre: e.target.value })}>
                <option value="">Any genre</option>
                {genreOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                {items.some((i) => !i.genre) && <option value={NO_GENRE}>No genre yet</option>}
              </select>
            )}
            <select className={filters.bpm ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.bpm} aria-label="BPM" onChange={(e) => setFilters({ bpm: e.target.value })}>
              <option value="">Any BPM</option>
              {BPM_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label} BPM</option>)}
            </select>
            <select className={filters.song !== "any" ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.song} aria-label="Songs" onChange={(e) => setFilters({ song: e.target.value as LibFilters["song"] })}>
              <option value="any">Any songs</option>
              <option value="has">Has a song</option>
              <option value="soundcloud">On SoundCloud</option>
              <option value="nosong">No song yet</option>
            </select>
            {yearOptions.length > 1 && (
              <select className={filters.year ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.year} aria-label="Year last saved" onChange={(e) => setFilters({ year: e.target.value })}>
                <option value="">Any year</option>
                {yearOptions.map((y) => <option key={y} value={y}>Saved in {y}</option>)}
              </select>
            )}
            {(anyRated || filters.rated > 0) && (
              <select className={filters.rated ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.rated} aria-label="Rating" onChange={(e) => setFilters({ rated: Number(e.target.value) })}>
                <option value={0}>Any rating</option>
                <option value={3}>Rated 3 and up</option>
                <option value={4}>Rated 4 and up</option>
                <option value={5}>Rated 5</option>
              </select>
            )}
            <span className="lib-find__count">
              {filtered ? <>Showing <b>{fmtCount(shown.length)}</b> of {fmtCount(items.length)} project{items.length === 1 ? "" : "s"}</> : <>{fmtCount(items.length)} project{items.length === 1 ? "" : "s"}</>}
            </span>
            {filtered && (
              <button className="lib-find__clear" onClick={() => setFilters(null)}>
                <Icon name="close" size={12} />Clear all
              </button>
            )}
            <AuditionToggle />
          </div>
          <SmartBar scope="library" filters={filters} blank={NO_FILTERS} canSave={filtered}
            suggest={(f) => describeFilters(f, (d) => DAW_NAMES[d] || d)}
            count={(f) => applyFilters(items, f).length}
            onPick={(f) => setFilters(f ?? null)} />
          {look === "sleeve" && (
            <FacetChips genres={browse.genres} years={browse.years} genre={filters.genre} year={filters.year}
              onGenre={(g) => setFilters({ genre: g })} onYear={(y) => setFilters({ year: y })} yearTitle="Saved in" />
          )}
          {unmatched > 0 && (
            <button type="button" className="lib-unmatched" onClick={() => setShowUnmatched(true)}>
              <Icon name="music" size={14} />
              <span><b>{fmtCount(unmatched)}</b> song{unmatched === 1 ? " isn't" : "s aren't"} matched to a project yet</span>
              <span className="lib-unmatched__go">Sort {unmatched === 1 ? "it" : "them"}<Icon name="chevronRight" size={13} /></span>
            </button>
          )}
          {notice && <p className="lib-notice">{notice}</p>}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading your library…</div>
      ) : loadFailed && items.length === 0 ? (
        <EmptyState pose="tangled" title="Couldn't read your library"
          action={<Button size="sm" onClick={() => (window as any).ablebackup?.relaunch?.()}>Restart the app</Button>}>
          Restart the app; your projects are untouched.
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState pose="searching" title="No projects here yet" say="Empty crate. Let’s go digging."
          action={<Button size="sm" onClick={() => runScan()} disabled={scanning}>{scanning ? "Scanning…" : "Scan now"}</Button>}>
          Pick where to look above, then scan. Backups finds Ableton, FL Studio, Logic Pro, Studio One, Reaper, Audacity, Bitwig and DAWproject projects.
        </EmptyState>
      ) : columns ? (
        <ColumnBrowse genres={browse.genres} years={browse.years} total={browse.total} inGenre={browse.inGenre}
          genre={filters.genre} year={filters.year} yearTitle="Year last saved" noun={`Projects (${fmtCount(shown.length)})`}
          onGenre={(g) => setFilters({ genre: g, year: "" })} onYear={(y) => setFilters({ year: y })}>
          {shown.length === 0 ? <p className="browse__empty">No projects here. Pick another genre or year.</p>
            : shown.map((it) => {
              const st = statusLine(it);
              return (
                <button key={it.project_id} type="button" className="browse__item" data-nav-key={it.project_id}
                  onClick={() => onOpen(it.project_id)}
                  onContextMenu={(e) => openMenu(e, [
                    { label: "Show backups & details", onClick: () => onOpen(it.project_id) },
                    { label: `Open in ${DAW_NAMES[it.daw ?? ""] ?? "its DAW"}`, onClick: () => openInDaw(it.path) },
                    "-", ...ratingMenu([it.project_id], ratingOf(it.project_id)), "-",
                    { label: it.genre ? "Change genre…" : "Set genre…", onClick: () => changeGenre([it]) },
                    { label: "Change cover…", onClick: () => { pickCover({ title: it.name, name: it.name, genre: it.genre }); } },
                  ])}>
                  <span className="stripe" style={{ background: genreColor(it.genre) }} />
                  <Cover name={it.name} genre={it.genre} size={28} />
                  <span className="browse__itemtext">
                    <span className="lib-name" title={it.name}>{it.name}</span>
                    <span className="lib-sub">{[it.bpm ? `${Math.round(it.bpm)} BPM` : "", dawLabel(it.daw), yearOf(it)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Rating id={it.project_id} name={it.name} size={11} readOnly />
                  <span className={`dot ${st.tone === "ok" ? "dot--ok" : st.tone === "warn" ? "dot--warn" : st.tone === "changed" ? "dot--accent" : ""}`}
                    title={st.tone === "ok" ? "Safe" : st.text} />
                </button>
              );
            })}
        </ColumnBrowse>
      ) : shown.length === 0 ? (
        onlyMissing
          ? <EmptyState pose="thumbs-up" title="Nothing missing" say="All there. Back to my nap.">Every project's samples are where they should be.</EmptyState>
          : <EmptyState pose="searching" say="I looked everywhere." title={filters.q.trim() ? `No projects match “${filters.q.trim()}”` : "No projects match"}
              action={<Button variant="ghost" size="sm" onClick={() => setFilters(null)}>Clear search and filters</Button>}>
              Try fewer words or a different filter.
            </EmptyState>
      ) : (
        owners.map((owner) => {
          const list = byOwner[owner];
          const isCollapsed = collapsed[owner];
          const ownerBacked = list.filter((i) => i.backed_up).length;
          const rowProps = (it: LibraryItem) => {
            const working = busy.has(it.project_id);
            const dawName = DAW_NAMES[it.daw ?? ""] ?? "its DAW";
            const openIt = () => onOpen(it.project_id);
            const action = it.missing_count > 0 ? (
              <Button variant="ghost" size="sm" disabled={working} onClick={(e) => { e.stopPropagation(); findSamples(it); }}
                title="Search your sample folders for them and back the project up">Find missing samples</Button>
            ) : !it.backed_up || it.changed ? (
              <Button variant="ghost" size="sm" disabled={working} onClick={(e) => { e.stopPropagation(); backupOne(it); }}>
                {rowErr[it.project_id] ? "Try again" : "Back up"}
              </Button>
            ) : (
              <Button variant="quiet" size="sm" onClick={(e) => { e.stopPropagation(); openInDaw(it.path); }}>Open in {dawName}</Button>
            );
            const items = [
              { label: `Open in ${dawName}`, onClick: () => openInDaw(it.path) },
              { label: "Show backups & details", onClick: openIt },
              { label: it.backed_up ? "Back up again" : "Back up", onClick: () => backupOne(it), disabled: working },
              { label: pins.includes(it.project_id) ? "Unpin" : "Pin to the top", onClick: () => togglePin(it.project_id) },
              { label: it.genre ? "Change genre…" : "Set genre…", onClick: () => changeGenre([it]) },
              ...(it.missing_count > 0 ? [
                { label: "Find missing samples", onClick: () => { findSamples(it); }, disabled: working },
                { label: "Look for samples in a folder…", onClick: () => lookInFolder(it), disabled: working },
              ] : []),
              { label: "Tidy names…", onClick: () => setTidyFor([it]) },
              { label: `Show in ${osWords().fileManager}`, onClick: () => revealPath(it.path) },
            ];
            const menu = <RowMenu items={items} name={it.name} />;
            // right-click: the same actions, plus copying where the project lives
            const onContextMenu = (e: React.MouseEvent) => openMenu(e, [
              ...items.slice(0, 5), "-",
              ...ratingMenu(picked.has(it.project_id) ? [...picked] : [it.project_id], ratingOf(it.project_id)), "-",
              ...(it.genre ? [{ label: `Crate colour for ${it.genre}…`, onClick: () => pickCrateColor(it.genre!, it.name) }] : []),
              { label: "Change cover…", onClick: () => { pickCover({ title: it.name, name: it.name, genre: it.genre }); } },
              ...items.slice(5),
              { label: "Copy project path", onClick: () => { copyText(it.path); } },
            ] as MenuItem[]);
            const meta = it.latest_export ? { title: it.latest_export.name, project: it.name, projectId: it.project_id, genre: it.genre } : undefined;
            const isPin = pins.includes(it.project_id);
            const star = (
              <button type="button" className={`pinbtn${isPin ? " pinbtn--on" : ""}`} aria-pressed={isPin}
                title={isPin ? "Pinned to the top. Click to unpin" : "Pin to the top"} aria-label={isPin ? `Unpin ${it.name}` : `Pin ${it.name}`}
                onClick={(e) => { e.stopPropagation(); togglePin(it.project_id); }}>
                <Icon name={isPin ? "starFilled" : "star"} size={14} />
              </button>
            );
            // the label around the tick makes a 24px target for a 15px box
            const tick = (
              <label className="lib-tickhit" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="lib-tick" checked={picked.has(it.project_id)} aria-label={`Pick ${it.name}`}
                  onClick={(e) => e.stopPropagation()} onChange={() => togglePick(it.project_id)} />
              </label>
            );
            const failed = rowErr[it.project_id];
            return { working, openIt, action, menu, meta, onContextMenu, star, tick, isPin, failed };
          };
          return (
            <div key={owner} style={{ marginBottom: 18 }}>
              {owners.length > 1 && (
                <div className="foldergroup__head">
                  <button className="foldergroup__title" onClick={() => setCollapsed((c) => ({ ...c, [owner]: !c[owner] }))}>
                    <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} size={14} />
                    <span>{ownerLabel(owner)}</span>
                    <span className="sub">{list.length} project{list.length === 1 ? "" : "s"} · {ownerBacked} backed up</span>
                  </button>
                </div>
              )}
              {!isCollapsed && look === "sleeve" && (
                <div className="sleeves">
                  {list.map((it) => {
                    const st = statusLine(it);
                    const { working, openIt, menu, meta, onContextMenu, star, tick, isPin, failed } = rowProps(it);
                    return (
                      <AuditionDiv key={it.project_id} song={it.latest_export?.path} meta={meta} data-pid={it.project_id} data-nav-key={it.project_id}
                        className={`sleeve${picking ? " sleeve--picking" : ""}${picked.has(it.project_id) ? " sleeve--selected" : ""}${isPin ? " sleeve--pinned" : ""}`} role="button" tabIndex={0}
                        onClick={openIt} onContextMenu={onContextMenu} onKeyDown={rowKey(openIt)}>
                        <div className="sleeve__art">
                          <Cover name={it.name} genre={it.genre} />
                          <span className="sleeve__tick">{tick}</span>
                          <span className="sleeve__badge" title={failed && !working ? failed : st.tone === "warn" && it.missing_count > 999 ? `${fmtCount(it.missing_count)} samples missing` : undefined}>
                            <span className={`dot ${failed && !working ? "dot--error" : st.tone === "ok" ? "dot--ok" : st.tone === "warn" ? "dot--warn" : st.tone === "changed" ? "dot--accent" : ""}`} />
                            {working ? "Backing up…" : failed ? "Backup failed" : st.tone === "ok" ? "Safe" : st.tone === "warn" ? `${fmtCap(it.missing_count)} missing` : st.tone === "changed" ? "Changed" : "Not backed up"}
                          </span>
                          {it.latest_export && meta &&
                            <PlayButton path={it.latest_export.path} title={it.latest_export.name} meta={meta} size={34} className="sleeve__play" />}
                        </div>
                        <div className="sleeve__meta" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" }}>
                          <div style={{ minWidth: 0 }}>
                            <div className="sleeve__name" title={it.name}>{it.name}</div>
                            <div className="sleeve__sub" title={plugTitle(it)}><GenreSub item={it} rest={[it.bpm ? `${Math.round(it.bpm)} BPM` : "", dawLabel(it.daw)]} /></div>
                            <Rating id={it.project_id} name={it.name} size={12} />
                            {failed && !working && <div className="lib-failed" role="status">{failed}</div>}
                          </div>
                          <span className="sleeve__acts">{star}{menu}</span>
                        </div>
                      </AuditionDiv>
                    );
                  })}
                </div>
              )}
              {!isCollapsed && look === "crate" && (
                <div className={`table table--crate rows--${rows}${picking ? " table--picking" : ""}`}>
                  <div className={`row cols cols-head ${colsClass}`}>
                    <span />
                    <span className="lib-tickcell">
                      <input type="checkbox" className="lib-tick" aria-label="Pick every project shown"
                        checked={list.length > 0 && list.every((i) => picked.has(i.project_id))}
                        onChange={(e) => setPicked((s) => { const n = new Set(s); list.forEach((i) => e.target.checked ? n.add(i.project_id) : n.delete(i.project_id)); return n; })} />
                    </span>
                    <span /><span /><span />
                    {([["name", "Project", ""], ["rating", "Rating", ""], ["song", "Latest song", ""], ["bpm", "BPM", " col-num"], ["status", "Backup", ""], ["backup", "Last backup", " col-num"]] as [SortKey, string, string][]).map(([k, label, cls]) => {
                      const on = sort?.key === k;
                      return (
                        <button key={k} className={`lib-sort${cls}${on ? " lib-sort--on" : ""}`} onClick={() => sortBy(k)}
                          aria-pressed={on} aria-label={on ? `${label}, sorted ${sort!.dir === 1 ? "up" : "down"}` : undefined}
                          title={`Sort by ${label.toLowerCase()}`}>
                          {label}{on && <Icon name={sort!.dir === 1 ? "arrowUp" : "arrowDown"} size={11} />}
                        </button>
                      );
                    })}
                    <span /><span />
                  </div>
                  {list.map((it) => {
                    const st = statusLine(it);
                    const { working, openIt, action, menu, meta, onContextMenu, star, tick, isPin, failed } = rowProps(it);
                    return (
                      <AuditionDiv key={it.project_id} song={it.latest_export?.path} meta={meta} data-pid={it.project_id} data-nav-key={it.project_id}
                        className={`row cols lib-row ${colsClass}${picked.has(it.project_id) ? " lib-row--picked" : ""}${isPin ? " lib-row--pinned" : ""}`} role="button" tabIndex={0}
                        onClick={openIt} onContextMenu={onContextMenu} onKeyDown={rowKey(openIt)}>
                        <span className="stripe" style={{ background: genreColor(it.genre) }} />
                        <span className="lib-tickcell">{tick}</span>
                        {it.latest_export && meta
                          ? <PlayButton path={it.latest_export.path} title={it.latest_export.name} meta={meta} size={28} />
                          : <span className="playbtn-slot" aria-hidden />}
                        <Cover name={it.name} genre={it.genre} size={36} />
                        <span className="lib-pincell">{star}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="lib-namerow"><span className="lib-name" title={it.name}>{it.name}</span></div>
                          <div className="lib-sub" title={plugTitle(it)}><GenreSub item={it} rest={[dawLabel(it.daw), st.size]} /></div>
                        </div>
                        <Rating id={it.project_id} name={it.name} />
                        {it.latest_export && meta
                          ? <SongWave path={it.latest_export.path} meta={meta} />
                          : <span className="lib-status">No song exported yet</span>}
                        <span className="lib-status col-num">{it.bpm ? Math.round(it.bpm) : "—"}</span>
                        {failed && !working ? (
                          <span className="lib-state lib-status--error" title={failed}>
                            <span className="dot dot--error" />
                            <span className="col-trunc">Backup failed: {failed}</span>
                          </span>
                        ) : (
                        <span className={`lib-state${st.tone === "warn" ? " lib-status--warn" : st.tone === "ok" ? " lib-status--ok" : ""}`}
                          title={st.tone === "changed" ? "Saved since its last backup" : st.tone === "warn" ? `${fmtCount(it.missing_count)} sample${it.missing_count === 1 ? "" : "s"} missing` : undefined}>
                          <span className={`dot ${st.tone === "ok" ? "dot--ok" : st.tone === "warn" ? "dot--warn" : st.tone === "changed" ? "dot--accent" : ""}`} />
                          <span className="col-trunc">{working ? "Backing up…" : st.tone === "ok" ? "Safe" : st.text}</span>
                        </span>
                        )}
                        <span className="lib-status col-num">{st.when}</span>
                        <div className="col-act">{action}</div>
                        {menu}
                      </AuditionDiv>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
      {picking && (() => {
        const allPinned = pickedItems.every((i) => pins.includes(i.project_id));
        const missing = pickedItems.filter((i) => i.missing_count > 0);
        return (
          <div className="pickbar" role="toolbar" aria-label="Ticked projects">
            <span className="pickbar__n"><b>{picked.size}</b> picked</span>
            <Button size="sm" onClick={() => { backupMany(pickedItems); setPicked(new Set()); }} disabled={changedBusy}>
              Back up {picked.size === 1 ? "this one" : `these ${picked.size}`}
            </Button>
            {missing.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { backupMany(missing); setPicked(new Set()); }} disabled={changedBusy}
                title="Back these up while searching your sample folders for what's missing">
                Find missing samples ({missing.length})
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setTidyFor(pickedItems)}
              title="Give each picked song's versions, folder and exported songs matching names">
              <Icon name="edit" size={13} /> Tidy names
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPins(pickedItems.map((i) => i.project_id), !allPinned)}>
              <Icon name={allPinned ? "star" : "starFilled"} size={13} /> {allPinned ? "Unpin" : "Pin to the top"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => changeGenre(pickedItems)}>Set genre…</Button>
            <Button size="sm" variant="ghost" onClick={(e) => openMenu(e, ratingMenu([...picked], 0))}>Rate…</Button>
            <button type="button" className="linkbtn pickbar__clear" onClick={() => setPicked(new Set())}>Clear</button>
          </div>
        );
      })()}
      {tidyFor && <TidyNames items={tidyFor} onClose={() => setTidyFor(null)} onDone={tidyDone} />}
    </>
  );
}

// The plugins a project uses, as the tooltip on the line under its name.
const plugTitle = (it: LibraryItem) => (it.plugins?.length ? `Plugins: ${it.plugins.join(", ")}` : undefined);

// The line under a project's name: its genre (dotted underline when the app guessed
// it, plain when you set it) then the other facts.
function GenreSub({ item, rest }: { item: LibraryItem; rest: (string | null | undefined)[] }) {
  const others = rest.filter(Boolean).join(" · ");
  if (!item.genre) return <>{others}</>;
  return (
    <>
      <span className={item.genre_by_you ? "" : "genre-guess"}
        title={item.genre_by_you ? "Genre set by you" : "Genre guessed from tempo and name. Right-click to correct it"}>{item.genre}</span>
      {others ? ` · ${others}` : ""}
    </>
  );
}

// After names were tidied, the project page says so and offers to put them back.
function TidyUndo({ projectId, tick, onUndone }: {
  projectId: string; tick: number; onUndone: (idMap: Record<string, string>) => void;
}) {
  const [batch, setBatch] = useState<TidyBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setErr(null);
    api.tidyLast(projectId).then((r) => { if (alive) setBatch(r.batch); }).catch(() => {});
    return () => { alive = false; };
  }, [projectId, tick]);
  if (!batch) return null;
  const when = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/.exec(batch.at);
    if (!m) return "";
    return fmtDay(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), { time: true, year: false });
  })();
  async function undo() {
    setBusy(true); setErr(null);
    try {
      const r = await api.tidyUndo(batch!.id);
      setBatch(null);
      onUndone(r.id_map);
    } catch (e: any) { setErr(e.message || "Couldn't put the names back."); }
    finally { setBusy(false); }
  }
  return (
    <div className="banner tidy-undo" role="status">
      <Icon name="check" size={15} />
      <span className="grow">{err ?? <>Names tidied {when}: {batch.count} renamed. Changed your mind?</>}</span>
      <Button size="sm" variant="ghost" onClick={undo} disabled={busy}>{busy ? "Putting back…" : "Undo"}</Button>
    </div>
  );
}
