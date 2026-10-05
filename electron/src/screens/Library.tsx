import { useEffect, useMemo, useRef, useState } from "react";
import { makeApi } from "../api";
import type { LibraryItem } from "../types";
import type { ScanProgress } from "../useProgress";
import { Button } from "../components/Button";
import { ProgressBar } from "../components/ProgressBar";
import { fmtSize, fmtDate, dawLabel } from "../format";
import { ProjectBackups } from "./ProjectBackups";
import { ProjectLabel } from "./ProjectLabel";
import { ProjectExports } from "./ProjectExports";
import { PlayButton, SongWave } from "../components/Player";
import { MissingSamples } from "./MissingSamples";
import { currentOs, osWords } from "../platform";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { genreColor, useLook } from "../look";
import { PageHeader } from "../components/PageHeader";
import { BPM_BANDS, FIRST_DIR, NO_FILTERS, applyFilters, rememberSort, rememberedSort, sortItems, type LibSort, type SortKey, extraFilterCount, isFiltered, itemStatus, rememberFilters, rememberedFilters, type LibFilters, type StatusFilter } from "../libraryFilter";
import { openMenu, type MenuItem } from "../components/Desktop";
import { copyText, keep, recall } from "../desktop";
import { pinnedFirst, setPins, togglePin, usePins } from "../pins";
import { EmptyState } from "../components/SlothSpot";
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
  ableton: "Ableton Live", flstudio: "FL Studio", reaper: "Reaper", dawproject: "DAWproject", audacity: "Audacity",
  logic: "Logic Pro", studioone: "Studio One",
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
    return { tone: "warn", text: `${n} sample${n === 1 ? "" : "s"} missing`, when: it.backed_up ? fmtDate(it.last_backup) : "not backed up", size };
  }
  if (it.changed) return { tone: "changed", text: "Changed", when: fmtDate(it.last_backup), size };
  if (it.backed_up) return { tone: "ok", text: "Verified", when: fmtDate(it.last_backup), size };
  return { tone: "none", text: "Not backed up yet", when: "—", size };
}

// The "···" menu on a row: the less common actions, out of the way.
function RowMenu({ items }: { items: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className={`lib-menu${open ? " lib-menu--open" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button className="iconbtn" aria-label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="more" /></button>
      {open && (
        <div className="lib-menu__list" role="menu">
          {items.map((m) => (
            <button key={m.label} role="menuitem" className="lib-menu__item" disabled={m.disabled}
              onClick={() => { setOpen(false); m.onClick(); }}>{m.label}</button>
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
export function Library({ scan, openProject, onOpen, onClose, scanOnOpen = false, onScanStarted }: {
  scan: ScanProgress; openProject?: string | null;
  onOpen: (projectId: string) => void; onClose: () => void;
  scanOnOpen?: boolean; onScanStarted?: () => void;  // first run: find projects straight away
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
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
  const [fixingAll, setFixingAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);  // one-line result of "Fix all"
  const lastOpen = useRef<string | null>(null);  // the project page shown last, to un-fold its group

  function load() {
    api.library().then((r) => setItems(r.projects)).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);
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

  async function backupOne(item: LibraryItem, extraLib?: string) {
    setBusy((s) => new Set(s).add(item.project_id)); setErr(null);
    try {
      const { job_id } = await api.startBackup({
        als_paths: [item.path], portable: true, layout: "project_date", find_missing: true,
        libraries: extraLib ? [extraLib] : undefined,
      });
      for (;;) {
        const st = await api.jobStatus(job_id);
        if (st.state === "done" || st.state === "error") break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch (e: any) { setErr(e.message || "Backup failed."); }
    finally {
      setBusy((s) => { const n = new Set(s); n.delete(item.project_id); return n; });
      load();
    }
  }

  // Back up several projects in one run (the changed ones, or the ticked ones).
  const [changedBusy, setChangedBusy] = useState(false);
  const backupChanged = () => backupMany(items.filter((i) => i.changed && i.missing_count === 0));
  async function backupMany(targets: LibraryItem[]) {
    if (!targets.length) return;
    setChangedBusy(true); setErr(null);
    setBusy((s) => new Set([...s, ...targets.map((t) => t.project_id)]));
    try {
      const { job_id } = await api.startBackup({
        als_paths: targets.map((t) => t.path), portable: true, layout: "project_date", find_missing: true,
      });
      for (;;) {
        const st = await api.jobStatus(job_id);
        if (st.state === "done" || st.state === "error") break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch (e: any) { setErr(e.message || "Backup failed."); }
    finally {
      setBusy((s) => { const n = new Set(s); targets.forEach((t) => n.delete(t.project_id)); return n; });
      setChangedBusy(false);
      load();
    }
  }

  // Point the finder at a folder you think this project's samples are in.
  async function lookInFolder(item: LibraryItem) {
    const dir = await bridge()?.pickFolder?.();
    if (dir) backupOne(item, dir);
  }

  // Fix everything at once: one backup pass over every project with missing samples,
  // auto-finding from your libraries + sources.
  async function fixAll() {
    const targets = items.filter((i) => i.missing_count > 0);
    if (targets.length === 0) return;
    setFixingAll(true); setErr(null); setNotice(null);
    const before = targets.reduce((n, t) => n + t.missing_count, 0);
    try {
      const { job_id } = await api.startBackup({
        als_paths: targets.map((t) => t.path), portable: true, layout: "project_date", find_missing: true,
      });
      for (;;) {
        const st = await api.jobStatus(job_id);
        if (st.state === "done" || st.state === "error") break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      const r = await api.library();
      setItems(r.projects);
      const after = r.projects.reduce((n, t) => n + t.missing_count, 0);
      const found = before - after;
      setNotice(found > 0
        ? `Found ${found} of ${before} missing sample${before === 1 ? "" : "s"}.${after > 0 ? ` ${after} still missing — open a project and point me to them.` : ""}`
        : `None of the ${before} missing sample${before === 1 ? "" : "s"} turned up in your folders — open a project and point me to them.`);
    } catch (e: any) { setErr(e.message || "Fix-all failed."); }
    finally { setFixingAll(false); }
  }

  const attentionCount = items.filter((i) => i.missing_count > 0).length;
  const changedItems = items.filter((i) => i.changed && i.missing_count === 0);
  const pins = usePins();
  const shown = useMemo(() => pinnedFirst(sortItems(applyFilters(items, filters), sort), pins), [items, filters, sort, pins]);
  // Ticked projects, for doing one thing to several at once.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickedItems = items.filter((i) => picked.has(i.project_id));
  const picking = picked.size > 0;
  // the status buttons count what the other filters leave, so the numbers add up
  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: 0, safe: 0, changed: 0, missing: 0, none: 0 };
    for (const it of applyFilters(items, filters, true)) { c.all++; c[itemStatus(it)]++; }
    return c;
  }, [items, filters]);
  const dawOptions = useMemo(() => [...new Set(items.map((i) => i.daw || "").filter(Boolean))].sort(), [items]);
  const genreOptions = useMemo(() => [...new Set(items.map((i) => i.genre || "").filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
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
  const backedUp = items.filter((i) => i.backed_up).length;

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
        <button className="lib-back" onClick={onClose}><Icon name="arrowLeft" size={14} />Library</button>
        <ProjectLabel item={it}
          onOpenInDaw={() => openInDaw(it.path)}
          onReveal={() => revealPath(it.path)}
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
              : <EmptyState pose="napping" title="No backups of this project yet">Press Back up now at the top and the first one shows here.</EmptyState> },
          ]} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Library"
        subtitle={<>{items.length} project{items.length === 1 ? "" : "s"} · {backedUp} backed up. Click one for its details and backups.</>}
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
        <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={scanning}>
          {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <Button size="sm" onClick={() => runScan()} disabled={scanning}>
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
                  {label} <span className="lib-find__n">{statusCounts[k]}</span>
                </button>
              ))}
            </div>
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
            <span className="lib-find__count">
              {filtered ? <>Showing <b>{shown.length}</b> of {items.length} project{items.length === 1 ? "" : "s"}</> : <>{items.length} project{items.length === 1 ? "" : "s"}</>}
            </span>
            {filtered && (
              <button className="lib-find__clear" onClick={() => setFilters(null)}>
                <Icon name="close" size={12} />Clear all
              </button>
            )}
          </div>
          {notice && <p className="lib-notice">{notice}</p>}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading your library…</div>
      ) : items.length === 0 ? (
        <EmptyState pose="empty-crate" title="No projects here yet"
          action={<Button size="sm" onClick={() => runScan()} disabled={scanning}>{scanning ? "Scanning…" : "Scan now"}</Button>}>
          Pick where to look above, then scan. Backups finds Ableton, FL Studio, Reaper and DAWproject projects.
        </EmptyState>
      ) : shown.length === 0 ? (
        onlyMissing
          ? <EmptyState pose="thumbs-up" title="Nothing missing">Every project's samples are where they should be.</EmptyState>
          : <EmptyState pose="searching" title={filters.q.trim() ? `No projects match “${filters.q.trim()}”` : "No projects match"}
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
              <Button variant="ghost" size="sm" disabled={working} onClick={(e) => { e.stopPropagation(); openIt(); }}
                title="See which samples are missing and point me to them">Fix</Button>
            ) : !it.backed_up || it.changed ? (
              <Button variant="ghost" size="sm" disabled={working} onClick={(e) => { e.stopPropagation(); backupOne(it); }}>Back up</Button>
            ) : (
              <Button variant="quiet" size="sm" onClick={(e) => { e.stopPropagation(); openInDaw(it.path); }}
                title={`Open in ${dawName}`}>Open</Button>
            );
            const items = [
              { label: `Open in ${dawName}`, onClick: () => openInDaw(it.path) },
              { label: "Show backups & details", onClick: openIt },
              { label: it.backed_up ? "Back up again" : "Back up", onClick: () => backupOne(it), disabled: working },
              { label: pins.includes(it.project_id) ? "Unpin" : "Pin to the top", onClick: () => togglePin(it.project_id) },
              ...(it.missing_count > 0 ? [{ label: "Look for samples in a folder…", onClick: () => lookInFolder(it), disabled: working }] : []),
              { label: `Show in ${osWords().fileManager}`, onClick: () => revealPath(it.path) },
            ];
            const menu = <RowMenu items={items} />;
            // right-click: the same actions, plus copying where the project lives
            const onContextMenu = (e: React.MouseEvent) => openMenu(e, [
              ...items.slice(0, 4), "-",
              ...items.slice(4),
              { label: "Copy project path", onClick: () => { copyText(it.path); } },
            ] as MenuItem[]);
            const meta = it.latest_export ? { title: it.latest_export.name, project: it.name, genre: it.genre } : undefined;
            const isPin = pins.includes(it.project_id);
            const star = (
              <button type="button" className={`pinbtn${isPin ? " pinbtn--on" : ""}`} aria-pressed={isPin}
                title={isPin ? "Pinned to the top. Click to unpin" : "Pin to the top"} aria-label={isPin ? `Unpin ${it.name}` : `Pin ${it.name}`}
                onClick={(e) => { e.stopPropagation(); togglePin(it.project_id); }}>
                <Icon name={isPin ? "starFilled" : "star"} size={14} />
              </button>
            );
            const tick = (
              <input type="checkbox" className="lib-tick" checked={picked.has(it.project_id)} aria-label={`Pick ${it.name}`}
                onClick={(e) => e.stopPropagation()} onChange={() => togglePick(it.project_id)} />
            );
            return { working, openIt, action, menu, meta, onContextMenu, star, tick, isPin };
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
                    const { working, openIt, menu, meta, onContextMenu, star, tick, isPin } = rowProps(it);
                    return (
                      <div key={it.project_id} data-pid={it.project_id} data-nav-key={it.project_id}
                        className={`sleeve${picking ? " sleeve--picking" : ""}${picked.has(it.project_id) ? " sleeve--selected" : ""}${isPin ? " sleeve--pinned" : ""}`} role="button" tabIndex={0}
                        onClick={openIt} onContextMenu={onContextMenu}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIt(); } }}>
                        <div className="sleeve__art">
                          <Cover name={it.name} genre={it.genre} />
                          <span className="sleeve__tick">{tick}</span>
                          <span className="sleeve__badge">
                            <span className={`dot ${st.tone === "ok" ? "dot--ok" : st.tone === "warn" ? "dot--warn" : st.tone === "changed" ? "dot--accent" : ""}`} />
                            {working ? "Backing up…" : st.tone === "ok" ? "Safe" : st.tone === "warn" ? `${it.missing_count} missing` : st.tone === "changed" ? "Changed" : "Not backed up"}
                          </span>
                          {it.latest_export && meta &&
                            <PlayButton path={it.latest_export.path} title={it.latest_export.name} meta={meta} size={34} className="sleeve__play" />}
                        </div>
                        <div className="sleeve__meta" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" }}>
                          <div style={{ minWidth: 0 }}>
                            <div className="sleeve__name" title={it.name}>{it.name}</div>
                            <div className="sleeve__sub">{[it.genre, it.bpm ? `${Math.round(it.bpm)} BPM` : "", dawLabel(it.daw)].filter(Boolean).join(" · ")}</div>
                          </div>
                          <span className="sleeve__acts">{star}{menu}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!isCollapsed && look === "crate" && (
                <div className={`table table--crate${picking ? " table--picking" : ""}`}>
                  <div className={`row cols cols-head ${colsClass}`}>
                    <span className="lib-tickcell">
                      <input type="checkbox" className="lib-tick" aria-label="Pick every project shown"
                        checked={list.length > 0 && list.every((i) => picked.has(i.project_id))}
                        onChange={(e) => setPicked((s) => { const n = new Set(s); list.forEach((i) => e.target.checked ? n.add(i.project_id) : n.delete(i.project_id)); return n; })} />
                    </span>
                    <span /><span /><span />
                    {([["name", "Project", ""], ["song", "Latest song", ""], ["bpm", "BPM", " col-num"], ["status", "Backup", ""], ["backup", "Last backup", " col-num"]] as [SortKey, string, string][]).map(([k, label, cls]) => {
                      const on = sort?.key === k;
                      return (
                        <button key={k} className={`lib-sort${cls}${on ? " lib-sort--on" : ""}`} onClick={() => sortBy(k)}
                          aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}
                          title={`Sort by ${label.toLowerCase()}`}>
                          {label}{on && <Icon name={sort!.dir === 1 ? "arrowUp" : "arrowDown"} size={11} />}
                        </button>
                      );
                    })}
                    <span /><span />
                  </div>
                  {list.map((it) => {
                    const st = statusLine(it);
                    const { working, openIt, action, menu, meta, onContextMenu, star, tick, isPin } = rowProps(it);
                    return (
                      <div key={it.project_id} data-pid={it.project_id} data-nav-key={it.project_id}
                        className={`row cols lib-row ${colsClass}${picked.has(it.project_id) ? " lib-row--picked" : ""}${isPin ? " lib-row--pinned" : ""}`} role="button" tabIndex={0}
                        onClick={openIt} onContextMenu={onContextMenu}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIt(); } }}>
                        <span className="lib-tickcell">{tick}</span>
                        <span className="stripe" style={{ background: genreColor(it.genre) }} />
                        {it.latest_export && meta
                          ? <PlayButton path={it.latest_export.path} title={it.latest_export.name} meta={meta} size={28} />
                          : <span className="playbtn-slot" aria-hidden />}
                        <Cover name={it.name} genre={it.genre} size={36} />
                        <div style={{ minWidth: 0 }} title={it.plugins?.length ? `Plugins: ${it.plugins.join(", ")}` : undefined}>
                          <div className="lib-namerow">{star}<span className="lib-name">{it.name}</span></div>
                          <div className="lib-sub">{[it.genre, dawLabel(it.daw), st.size].filter(Boolean).join(" · ")}</div>
                        </div>
                        {it.latest_export && meta
                          ? <SongWave path={it.latest_export.path} meta={meta} />
                          : <span className="lib-status">No song exported yet</span>}
                        <span className="lib-status col-num">{it.bpm ? Math.round(it.bpm) : "—"}</span>
                        <span className={`lib-state${st.tone === "warn" ? " lib-status--warn" : st.tone === "ok" ? " lib-status--ok" : ""}`}
                          title={st.tone === "changed" ? "Saved since its last backup" : undefined}>
                          <span className={`dot ${st.tone === "ok" ? "dot--ok" : st.tone === "warn" ? "dot--warn" : st.tone === "changed" ? "dot--accent" : ""}`} />
                          <span className="col-trunc">{working ? "Backing up…" : st.tone === "ok" ? "Safe" : st.text}</span>
                        </span>
                        <span className="lib-status col-num">{st.when}</span>
                        <div className="col-act">{action}</div>
                        {menu}
                      </div>
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
            <Button size="sm" variant="ghost" onClick={() => setPins(pickedItems.map((i) => i.project_id), !allPinned)}>
              <Icon name={allPinned ? "star" : "starFilled"} size={13} /> {allPinned ? "Unpin" : "Pin to the top"}
            </Button>
            <button type="button" className="linkbtn pickbar__clear" onClick={() => setPicked(new Set())}>Clear</button>
          </div>
        );
      })()}
    </>
  );
}
