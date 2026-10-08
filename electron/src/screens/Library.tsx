import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import { MoreMenu as RowMenu } from "../components/MoreMenu";
import { Cover } from "../components/Cover";
import { genreColor, useLook } from "../look";
import { FILLED, Rating, RowSize, ratingMenu } from "../components/Marks";
import { ratingOf, renameRatings, useDensity, useRatings } from "../marks";
import { pickGenre, pickCrateColor } from "../components/GenrePick";
import { PageHeader } from "../components/PageHeader";
import { UnmatchedSongs } from "./UnmatchedSongs";
import { SmartBar } from "../components/SmartBar";
import { ColumnBrowse, NO_GENRE, facets } from "../components/Browse";
import { BPM_BANDS, FIRST_DIR, NO_FILTERS, applyFilters, describeFilters, yearOf, rememberSort, rememberedSort, sortItems, type LibSort, type SortKey, extraFilterCount, isFiltered, countStatuses, statusSummary, rememberFilters, rememberedFilters, type LibFilters, type LibraryView, type StatusFilter, viewFor } from "../libraryFilter";
import { openMenu, toast, type MenuItem, toastWarn } from "../components/Desktop";
import { copyText, keep, recall } from "../desktop";
import { pinnedFirst, renamePins, setPins, togglePin, usePins } from "../pins";
import { renameRecents } from "../recents";
import { NoteOpened } from "../components/Recents";
import { TidyNames } from "./TidyNames";
import type { TidyBatch, TidyDone } from "../types";
import { EmptyState } from "../components/SlothSpot";
import { ScanSloth } from "../components/ScanSloth";
import { rowKey } from "../components/a11y";
import { backupAndWait, type RunResult } from "../runBackup";
import { SONGS_LINKED, SongDropTarget, useSongDrop, useSongDragActive } from "../songDrop";
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

// "More filters": the less used pickers (DAW, tempo, songs, rating) in a small panel,
// so the Library keeps two rows of controls. `on` counts the ones in use, shown on the
// button. Escape or a click outside closes it; focus goes back to the button.
function MoreFilters({ on, children }: { on: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLSelectElement>(".lib-more__panel select")?.focus();
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="lib-more"
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); } }}>
      <button ref={btn} type="button" className={`lib-pick lib-more__btn${on ? " lib-pick--on" : ""}`}
        aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        More filters{on > 0 && <span className="lib-more__n">{on}</span>}<Icon name="chevronDown" size={13} />
      </button>
      {open && <div className="lib-more__panel" role="dialog" aria-label="More filters">{children}</div>}
    </div>
  );
}

// Which owner groups are folded shut, kept while the app is open so the list looks
// the same when you come back to it.
let rememberedCollapsed: Record<string, boolean> = {};
// The scan reach is saved for the next time the app opens too. Until the person picks
// one it starts on the folders chosen at setup (what setup scanned), not the whole
// computer, so unticked folders don't come back and no extra access prompts appear.
const savedScope = recall<string>("lc-library-scope", "", (v) => SCOPES.some((s) => s.key === v));
let rememberedScope = savedScope || "sources";
let savedScopeTouched = false;

// Big libraries: rows are drawn a page at a time, more as the list scrolls near its
// end, so typing in the search box or changing a filter never waits for thousands of
// rows. How far it has drawn is kept while the app is open, so coming back to the
// Library finds the row you came from.
const PAGE = 120;
let rememberedLimit = PAGE;

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
  const setScope = (v: string) => { rememberedScope = v; savedScopeTouched = true; keep("lc-library-scope", v); setScopeState(v); };
  const [scanning, setScanning] = useState(false);
  const [fdaOk, setFdaOk] = useState(true);
  const [skipped, setSkipped] = useState(0);     // dirs the last scan couldn't read
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // projects whose backup from this page just finished and checked out: their status
  // settles to "Safe" with a small seal for a moment
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  const doneTimers = useRef<number[]>([]);
  useEffect(() => () => doneTimers.current.forEach((t) => clearTimeout(t)), []);
  const markDone = (ids: string[]) => {
    if (!ids.length) return;
    setJustDone((s) => new Set([...s, ...ids]));
    doneTimers.current.push(window.setTimeout(() => setJustDone((s) => {
      const n = new Set(s); ids.forEach((id) => n.delete(id)); return n;
    }), 2600));
  };
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
  // A song dropped on a project (or its Undo): show its new latest song.
  useEffect(() => {
    const again = () => { load(); };
    window.addEventListener(SONGS_LINKED, again);
    return () => window.removeEventListener(SONGS_LINKED, again);
  }, []);
  const songDrag = useSongDragActive();
  // No folders were chosen at setup: "My folders" would find nothing, so look in the
  // whole home folder instead (until the person picks a scope themselves).
  useEffect(() => {
    if (savedScope) return;
    api.getSettings().then((c) => { if (!c.sources?.length && !savedScopeTouched) { rememberedScope = "home"; setScopeState("home"); } }).catch(() => {});
  }, []);

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
    const at = owners.flatMap((o) => byOwner[o]).findIndex((i) => i.project_id === lastOpen.current);
    if (at >= limit) setLimit(() => at + PAGE);
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
    if (res.ok) markDone([item.project_id]);
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
    await load();
    const failedNames = new Set(res.ok ? [] : res.failed.map((f) => f.project_name));
    if (res.ok || res.failed.length) markDone(targets.filter((t) => !failedNames.has(t.name)).map((t) => t.project_id));
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
  // The list follows the search a beat behind the box: typing stays instant and the
  // rows catch up between keys (React drops a half-drawn list when another key lands).
  const dFilters = useDeferredValue(filters);
  const shown = useMemo(() => pinnedFirst(sortItems(applyFilters(items, dFilters), sort), pins), [items, dFilters, sort, pins, rated]);
  // Ticked projects, for doing one thing to several at once.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickedItems = items.filter((i) => picked.has(i.project_id));
  const picking = picked.size > 0;
  // the status buttons count what the other filters leave, so the numbers add up
  const statusCounts = useMemo(() => {
    return countStatuses(applyFilters(items, dFilters, true));
  }, [items, dFilters]);
  const allCounts = useMemo(() => countStatuses(items), [items]);
  const dawOptions = useMemo(() => [...new Set(items.map((i) => i.daw || "").filter(Boolean))].sort(), [items]);
  const anyRated = rated.replace(/[0,]/g, "") !== "";
  // Genre and Year to browse by, counted over what the other filters leave
  const browse = useMemo(() => {
    const pool = applyFilters(items, { ...dFilters, genre: "", year: "" });
    const inGenre = dFilters.genre ? applyFilters(pool, { ...NO_FILTERS, genre: dFilters.genre }).length : pool.length;
    return { ...facets(pool, (i) => i.genre, yearOf, dFilters.genre), total: pool.length, inGenre };
  }, [items, dFilters, rated, pins]);
  const columns = look === "crate" && view === "columns";
  // Favourites over the genres: how many of what the other filters leave are pinned or rated.
  const marks = useMemo(() => {
    const pool = applyFilters(items, { ...dFilters, pinned: false, rated: 0 });
    return {
      pinned: pool.filter((i) => pins.includes(i.project_id)).length,
      rated: pool.filter((i) => ratingOf(i.project_id) >= Math.max(1, dFilters.rated)).length,
    };
  }, [items, dFilters, rated, pins]);
  const { glyph } = useRatings();
  // the filters tucked behind "More filters" that are on now
  const moreOn = [filters.daw, filters.bpm, filters.song !== "any", filters.rated > 0, filters.pinned].filter(Boolean).length;
  const filtered = isFiltered(filters);
  // only "Missing samples" picked and nothing left: that's good news, not a failed search
  const onlyMissing = filters.status === "missing" && extraFilterCount(filters) === 0 && !filters.q.trim();
  // With no songs anywhere yet, or nothing rated yet, those columns leave so the rest has room.
  const colsClass = `lib-cols${items.some((i) => i.latest_export) ? "" : " lib-cols--nosongs"}${anyRated ? "" : " lib-cols--norating"}`;
  const byOwner = useMemo(() => {
    const m: Record<string, LibraryItem[]> = {};
    for (const it of shown) (m[it.owner || "system"] ||= []).push(it);
    return m;
  }, [shown]);
  const owners = useMemo(() => Object.keys(byOwner).sort(), [byOwner]);

  // How many rows are drawn (see PAGE). Back to one page when the search, a filter
  // or the sort changes; a page more each time the end of the list comes near.
  const [limit, setLimitState] = useState(rememberedLimit);
  const setLimit = (f: (n: number) => number) => setLimitState((n) => (rememberedLimit = f(n)));
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    setLimit(() => PAGE);
  }, [dFilters, sort]);
  const openRows = useMemo(() => owners.reduce((n, o) => n + (collapsed[o] ? 0 : byOwner[o].length), 0), [owners, byOwner, collapsed]);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const hasMore = openRows > limit;
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((n) => n + PAGE); },
      { root: document.querySelector(".main"), rootMargin: "0px 0px 1600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, limit, look]);

  // ETA from the parse rate (updates each project tick).
  const elapsed = scan.startedAt ? (Date.now() - scan.startedAt) / 1000 : 0;
  const eta = scan.phase === "parsing" && scan.done > 0 && scan.total > scan.done
    ? fmtEta((elapsed / scan.done) * (scan.total - scan.done)) : "";
  const showProgress = scanning || scan.active;
  let budget = limit;  // rows still to draw on this pass (see PAGE)

  // ── project page: replaces the list, with a way back ──
  const openItem = openProject
    ? items.find((i) => i.project_id === openProject) ?? items.find((i) => i.name === openProject) ?? null
    : null;
  if (openItem) lastOpen.current = openItem.project_id;
  // drop a song anywhere on an open project's page to link it to that project
  const pageDrop = useSongDrop(openItem);
  if (openProject && loading) return <div className="empty">Loading your library…</div>;
  if (openItem) {
    const it = openItem;
    return (
      <div className="songdrop-page" {...pageDrop.props}>
        {pageDrop.over && (
          <div className="songdrop-page__hint" aria-hidden="true">
            <Icon name="music" size={18} /><span>Drop to link to <b>{it.name}</b></span>
          </div>
        )}
        <NoteOpened id={it.project_id} name={it.name} cover={it.name} genre={it.genre} />
        <button className="lib-back" onClick={onClose}><Icon name="arrowLeft" size={14} />Library</button>
        <TidyUndo projectId={it.project_id} tick={tidyTick} onUndone={afterRename} />
        <ProjectLabel item={it}
          onGenre={() => changeGenre([it])}
          onOpenInDaw={() => openInDaw(it.path)}
          onReveal={() => revealPath(it.path)}
          more={[{ label: "Tidy names…", onClick: () => setTidyFor([it]) }]}
          actions={(!it.backed_up || it.changed) && (
            <Button disabled={busy.has(it.project_id)} onClick={() => backupOne(it)}>
              {busy.has(it.project_id) ? "Backing up…" : "Back up now"}
            </Button>
          )}
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
      </div>
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
        <span className="faint" style={{ fontSize: 12 }}>Look for projects in</span>
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
                <div className="sub" style={{ margin: "0 0 6px", fontSize: 12 }}>
                  Searching… {scan.dirs.toLocaleString()} folders · {scan.found} project{scan.found === 1 ? "" : "s"} found
                </div>
                <ProgressBar value={1} max={1} active />
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="sub" style={{ margin: 0, fontSize: 12 }}>Reading projects…</span>
                  <span className="sub mono" style={{ margin: 0, fontSize: 12 }}>
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
            <div style={{ fontSize: 12 }}>
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
          </div>
          {/* the second and last row: genre and year (one place to pick each), the rest
              behind More filters, the count, then how the list is shown */}
          <div className="lib-find__row">
            {browse.genres.length > 0 && (
              <select className={filters.genre ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.genre} aria-label="Genre" onChange={(e) => setFilters({ genre: e.target.value })}>
                <option value="">Any genre</option>
                {browse.genres.map((g) => <option key={g.value} value={g.value}>{g.label} · {fmtCount(g.n)}</option>)}
                {filters.genre && !browse.genres.some((g) => g.value === filters.genre) && <option value={filters.genre}>{filters.genre === NO_GENRE ? "No genre yet" : filters.genre}</option>}
              </select>
            )}
            {(browse.years.length > 1 || filters.year) && (
              <select className={filters.year ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.year} aria-label="Year last saved" onChange={(e) => setFilters({ year: e.target.value })}>
                <option value="">Any year</option>
                {browse.years.map((y) => <option key={y.value} value={y.value}>Saved in {y.label} · {fmtCount(y.n)}</option>)}
                {filters.year && !browse.years.some((y) => y.value === filters.year) && <option value={filters.year}>Saved in {filters.year}</option>}
              </select>
            )}
            <MoreFilters on={moreOn}>
              {dawOptions.length > 1 && (
                <label className="lib-more__field"><span>Made in</span>
                  <select className={filters.daw ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.daw} onChange={(e) => setFilters({ daw: e.target.value })}>
                    <option value="">Any DAW</option>
                    {dawOptions.map((d) => <option key={d} value={d}>{DAW_NAMES[d] || d}</option>)}
                  </select>
                </label>
              )}
              <label className="lib-more__field"><span>Tempo</span>
                <select className={filters.bpm ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.bpm} onChange={(e) => setFilters({ bpm: e.target.value })}>
                  <option value="">Any BPM</option>
                  {BPM_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label} BPM</option>)}
                </select>
              </label>
              <label className="lib-more__field"><span>Songs</span>
                <select className={filters.song !== "any" ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.song} onChange={(e) => setFilters({ song: e.target.value as LibFilters["song"] })}>
                  <option value="any">Any songs</option>
                  <option value="has">Has a song</option>
                  <option value="soundcloud">On SoundCloud</option>
                  <option value="nosong">No song yet</option>
                </select>
              </label>
              {(anyRated || filters.rated > 0) && (
                <label className="lib-more__field"><span>Rating</span>
                  <select className={filters.rated ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.rated} onChange={(e) => setFilters({ rated: Number(e.target.value) })}>
                    <option value={0}>Any rating</option>
                    <option value={1}>Rated at all</option>
                    <option value={3}>Rated 3 and up</option>
                    <option value={4}>Rated 4 and up</option>
                    <option value={5}>Rated 5</option>
                  </select>
                </label>
              )}
              {(pins.length > 0 || filters.pinned) && (
                <label className="lib-more__field"><span>Pinned</span>
                  <select className={filters.pinned ? "lib-pick lib-pick--on" : "lib-pick"} value={filters.pinned ? "1" : ""} onChange={(e) => setFilters({ pinned: e.target.value === "1" })}>
                    <option value="">Pinned or not</option>
                    <option value="1">Pinned only</option>
                  </select>
                </label>
              )}
            </MoreFilters>
            {filtered && (
              <>
                <span className="lib-find__count lib-find__showing">Showing <b>{fmtCount(shown.length)}</b> of {fmtCount(items.length)}</span>
                <button className="lib-find__clear" onClick={() => setFilters(null)}>
                  <Icon name="close" size={12} />Clear all
                </button>
              </>
            )}
            <SmartBar scope="library" filters={filters} blank={NO_FILTERS} canSave={filtered}
              suggest={(f) => describeFilters(f, (d) => DAW_NAMES[d] || d)}
              count={(f) => applyFilters(items, f).length}
              onPick={(f) => setFilters(f ? { ...NO_FILTERS, ...f } : null)} />
            <div className="lib-find__view">
              <AuditionToggle compact />
              {look === "crate" && !columns && <RowSize value={rows} onChange={setRows} />}
              {look === "crate" && (
                <div className="seg seg--icons" role="radiogroup" aria-label="Show as">
                  {([["list", "library", "List"], ["columns", "columns", "Genre, year, project columns"]] as const).map(([k, icon, label]) => (
                    <button key={k} type="button" role="radio" aria-checked={view === k} title={label} aria-label={label}
                      className={`seg__opt${view === k ? " seg__opt--on" : ""}`} onClick={() => setView(k)}><Icon name={icon} size={14} /></button>
                  ))}
                </div>
              )}
            </div>
          </div>
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
      ) : items.length === 0 && showProgress ? (
        <ScanSloth scan={scan} />
      ) : items.length === 0 ? (
        <EmptyState pose="searching" title="No projects here yet" say="Empty crate. Let’s go digging."
          action={<Button size="sm" onClick={() => runScan()} disabled={scanning}>{scanning ? "Scanning…" : "Scan now"}</Button>}>
          Pick where to look above, then scan. Backups finds every Ableton, FL Studio, Logic Pro, Studio One, Reaper, Audacity, Bitwig and DAWproject project in those folders, with the songs you exported from each.
        </EmptyState>
      ) : columns ? (
        <ColumnBrowse genres={browse.genres} years={browse.years} total={browse.total} inGenre={browse.inGenre}
          genre={filters.genre} year={filters.year} yearTitle="Year last saved" noun={`Projects (${fmtCount(shown.length)})`}
          onGenre={(g) => setFilters({ genre: g, year: "" })} onYear={(y) => setFilters({ year: y })}
          marks={[
            { key: "pinned", label: "Pinned", icon: "starFilled", tone: "pin", n: marks.pinned, on: filters.pinned, onToggle: () => setFilters({ pinned: !filters.pinned }) },
            { key: "rated", label: filters.rated > 1 ? `Rated ${filters.rated}${filters.rated < 5 ? " and up" : ""}` : "Rated", icon: FILLED[glyph], tone: "rate",
              n: marks.rated, on: filters.rated > 0, onToggle: () => setFilters({ rated: filters.rated ? 0 : 1 }) },
          ]}
          cols="36px 24px minmax(0, 1fr) 80px 116px" narrowCols="36px 24px minmax(0, 1fr) 80px 10px"
          heads={["Rating", <span className="browse__headwide">Backup</span>]}>
          {shown.length === 0 ? <p className="browse__empty">No projects here. Pick another genre or year.</p>
            : shown.map((it) => {
              const st = statusLine(it);
              const isPin = pins.includes(it.project_id);
              const openIt = () => onOpen(it.project_id);
              return (
                <SongDropTarget as="div" project={it} key={it.project_id} role="button" tabIndex={0} className={`browse__item${isPin ? " browse__item--pinned" : ""}`} data-nav-key={it.project_id}
                  onClick={openIt} onKeyDown={rowKey(openIt)}
                  onContextMenu={(e: React.MouseEvent) => openMenu(e, [
                    { label: "Show backups & details", onClick: openIt },
                    { label: `Open in ${DAW_NAMES[it.daw ?? ""] ?? "its DAW"}`, onClick: () => openInDaw(it.path) },
                    { label: isPin ? "Unpin" : "Pin to the top", onClick: () => togglePin(it.project_id) },
                    "-", ...ratingMenu([it.project_id], ratingOf(it.project_id)), "-",
                    { label: it.genre ? "Change genre…" : "Set genre…", onClick: () => changeGenre([it]) },
                    { label: "Change cover…", onClick: () => { pickCover({ title: it.name, name: it.name, genre: it.genre }); } },
                  ])}>
                  <span className="stripe" style={{ background: genreColor(it.genre) }} />
                  <Cover name={it.name} genre={it.genre} size={36} />
                  <button type="button" className={`pinbtn${isPin ? " pinbtn--on" : ""}`} aria-pressed={isPin}
                    title={isPin ? "Pinned to the top. Click to unpin" : "Pin to the top"} aria-label={isPin ? `Unpin ${it.name}` : `Pin ${it.name}`}
                    onClick={(e) => { e.stopPropagation(); togglePin(it.project_id); }}>
                    <Icon name={isPin ? "starFilled" : "star"} size={14} />
                  </button>
                  <span className="browse__itemtext">
                    <span className="lib-name" title={it.name}>{it.name}</span>
                    <span className="lib-sub">{[it.genre || "", it.bpm ? `${Math.round(it.bpm)} BPM` : "", dawLabel(it.daw), yearOf(it)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Rating id={it.project_id} name={it.name} size={13} />
                  <span className={`browse__state${st.tone === "warn" ? " browse__state--warn" : ""}`}
                    title={st.tone === "ok" ? "Safe" : st.tone === "warn" ? `${st.text}` : st.text}>
                    <span className={`dot ${st.tone === "ok" ? "dot--ok" : st.tone === "warn" ? "dot--warn" : st.tone === "changed" ? "dot--accent" : ""}`} />
                    <span className="browse__stateword col-trunc">{st.tone === "ok" ? "Safe" : st.tone === "warn" ? `${fmtCap(it.missing_count)} missing` : st.tone === "none" ? "Not backed up" : st.text}</span>
                  </span>
                </SongDropTarget>
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
        <div className="lib-wrap">{owners.map((owner) => {
          const list = byOwner[owner];
          const isCollapsed = collapsed[owner];
          // the rows of this group that fit in what's left of the page; groups past
          // the end of it wait until the list scrolls that far
          if (budget <= 0) return null;
          const drawn = isCollapsed ? list : list.slice(0, budget);
          if (!isCollapsed) budget -= drawn.length;
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
                  {drawn.map((it) => {
                    const st = statusLine(it);
                    const { working, openIt, menu, meta, onContextMenu, star, tick, isPin, failed } = rowProps(it);
                    const done = !working && !failed && st.tone === "ok" && justDone.has(it.project_id);
                    return (
                      <SongDropTarget as={AuditionDiv} project={it} key={it.project_id} song={it.latest_export?.path} meta={meta} data-pid={it.project_id} data-nav-key={it.project_id}
                        className={`sleeve${picking ? " sleeve--picking" : ""}${picked.has(it.project_id) ? " sleeve--selected" : ""}${isPin ? " sleeve--pinned" : ""}`} role="button" tabIndex={0}
                        onClick={openIt} onContextMenu={onContextMenu} onKeyDown={rowKey(openIt)}>
                        <div className="sleeve__art">
                          <Cover name={it.name} genre={it.genre} />
                          <span className="sleeve__tick">{tick}</span>
                          {/* a safe project's cover stays clean: the badge shows only when something
                              is happening or needs a look (the Safe filter still finds them all) */}
                          {done ? (
                            <span className="sleeve__badge sleeve__badge--done" role="status"><DoneSeal />Safe</span>
                          ) : (working || failed || st.tone !== "ok") && (
                          <span className="sleeve__badge" title={failed && !working ? failed : st.tone === "warn" && it.missing_count > 999 ? `${fmtCount(it.missing_count)} samples missing` : undefined}>
                            <span className={`dot ${failed && !working ? "dot--error" : st.tone === "ok" ? "dot--ok" : st.tone === "warn" ? "dot--warn" : st.tone === "changed" ? "dot--accent" : ""}`} />
                            {working ? "Backing up…" : failed ? "Backup failed" : st.tone === "ok" ? "Safe" : st.tone === "warn" ? `${fmtCap(it.missing_count)} missing` : st.tone === "changed" ? "Changed" : "Not backed up"}
                          </span>
                          )}
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
                      </SongDropTarget>
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
                    {([["name", "Project", ""], ["rating", "Rating", " col-mid"], ["song", "Latest song", ""], ["bpm", "BPM", " col-num"], ["status", "Backup", ""], ["backup", "Last backup", " col-num"]] as [SortKey, string, string][]).map(([k, label, cls]) => {
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
                  {drawn.map((it) => {
                    const st = statusLine(it);
                    const { working, openIt, action, menu, meta, onContextMenu, star, tick, isPin, failed } = rowProps(it);
                    const done = !working && !failed && st.tone === "ok" && justDone.has(it.project_id);
                    return (
                      <SongDropTarget as={AuditionDiv} project={it} key={it.project_id} song={it.latest_export?.path} meta={meta} data-pid={it.project_id} data-nav-key={it.project_id}
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
                          : <span className="lib-status col-trunc" title="No song exported from this project yet">No song yet</span>}
                        <span className="lib-status col-num">{it.bpm ? Math.round(it.bpm) : "—"}</span>
                        {failed && !working ? (
                          <span className="lib-state lib-status--error" title={failed}>
                            <span className="dot dot--error" />
                            <span className="col-trunc">Backup failed: {failed}</span>
                          </span>
                        ) : done ? (
                          <span className="lib-state lib-status--ok lib-state--done" role="status">
                            <DoneSeal /><span className="col-trunc">Safe</span>
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
                      </SongDropTarget>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {hasMore && <div ref={moreRef} className="lib-endmark" aria-hidden="true" />}
        </div>
      )}
      {songDrag && items.length > 0 && (
        <div className="songdrop-tip" role="status">
          <Icon name="music" size={15} />Drop the song on its project to link them. The file stays where it is.
        </div>
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

// The small seal a row's status wears for a moment when its backup has just finished
// and checked out: a green disc stamps in and the tick draws itself.
function DoneSeal() {
  return (
    <svg className="doneseal" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle className="doneseal__disc" cx="8" cy="8" r="7" />
      <path className="doneseal__tick" d="M4.6 8.3 l2.3 2.3 l4.5 -4.9" />
    </svg>
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
