import { useEffect, useMemo, useRef, useState } from "react";
import { makeApi } from "../api";
import type { LibraryItem } from "../types";
import type { ScanProgress } from "../useProgress";
import { Button } from "../components/Button";
import { ProgressBar } from "../components/ProgressBar";
import { fmtSize, fmtDate } from "../format";
import { DawBadge } from "../components/DawBadge";
import { SlothMascot } from "../components/SlothMascot";
import { ProjectBackups } from "./ProjectBackups";
import { ProjectLabel } from "./ProjectLabel";
import { ProjectExports } from "./ProjectExports";
import { PlayButton } from "../components/Player";
import { MissingSamples } from "./MissingSamples";
import { currentOs, osWords } from "../platform";
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
function statusLine(it: LibraryItem): { tone: "ok" | "warn" | "none"; text: string; when: string; size: string } {
  const size = fmtSize(it.size);
  if (it.missing_count > 0) {
    const n = it.missing_count;
    return { tone: "warn", text: `${n} sample${n === 1 ? "" : "s"} missing`, when: it.backed_up ? fmtDate(it.last_backup) : "not backed up", size };
  }
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
      <button className="lib-menu__btn" aria-label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)}>···</button>
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

export function Library({ scan, openProject, onOpenHandled }: {
  scan: ScanProgress; openProject?: string | null; onOpenHandled?: () => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("home");
  const [scanning, setScanning] = useState(false);
  const [fdaOk, setFdaOk] = useState(true);
  const [skipped, setSkipped] = useState(0);     // dirs the last scan couldn't read
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);  // project_id of the open detail row
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [fixingAll, setFixingAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);  // one-line result of "Fix all"

  function load() {
    api.library().then((r) => setItems(r.projects)).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  // Deep-link (Home's "needs attention", an orb, Dig's pick): expand that project's
  // detail row AND bring it into view — deep-list rows expand screens below the fold.
  useEffect(() => {
    if (!openProject || items.length === 0) return;
    const hit = items.find((i) => i.name === openProject);
    if (hit) {
      setExpanded(hit.project_id);
      setFilter("all");  // a deep-linked project must be visible regardless of filter
      // The row lives in its owner group; if that group is collapsed the row
      // isn't in the DOM, so un-collapse it before trying to scroll.
      setCollapsed((c) => ({ ...c, [hit.owner || "system"]: false }));
    }
    onOpenHandled?.();
  }, [openProject, items]);

  // The project page replaces the list, so start it at the top.
  useEffect(() => { document.querySelector(".main")?.scrollTo({ top: 0 }); }, [expanded]);

  async function runScan() {
    setScanning(true); setErr(null);
    try {
      // scanMac handles every scope incl. "sources"; returns skipped-dir count + FDA.
      const r = await api.scanMac(scope, true);
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
  const shown = filter === "attention" ? items.filter((i) => i.missing_count > 0) : items;
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
  const openItem = expanded ? items.find((i) => i.project_id === expanded) : null;
  if (openItem) {
    const it = openItem;
    return (
      <>
        <button className="lib-back" onClick={() => setExpanded(null)}>← Library</button>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* missing samples first — it's the thing that needs a decision */}
          {it.missing_count > 0 && <MissingSamples item={it} onChanged={load} />}
          {/* the project as a record — vitals on the label, life on the timeline */}
          <ProjectLabel item={it}
            onOpenInDaw={() => openInDaw(it.path)}
            onReveal={() => revealPath(it.path)} />
          {/* the songs exported from it: play, SoundCloud link, fix a wrong match */}
          <ProjectExports item={it} onChanged={load} />
          {/* Backups ARE this project's detail — actions live here. */}
          {it.backed_up ? (
            <div className="card" style={{ padding: "14px 16px" }}>
              <div className="sub" style={{ margin: "0 0 10px", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Backups
              </div>
              <ProjectBackups projectName={it.name} projectPath={it.path} onFixed={load} />
            </div>
          ) : (
            <div className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span className="sub" style={{ margin: 0 }}>No backups of this project yet.</span>
              <Button size="sm" disabled={busy.has(it.project_id)} onClick={() => backupOne(it)} style={{ marginLeft: "auto" }}>
                {busy.has(it.project_id) ? "Backing up…" : "Back up now"}
              </Button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Library</h1>
      <p className="sub">Every project a scan has found, backed up or not. Click one for its details and backups.</p>

      <div className="card lib-scan">
        <span className="sub" style={{ margin: 0 }}>Scan</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={scanning}>
          {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <Button size="sm" onClick={runScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan now"}
        </Button>
        <span className="sub mono lib-scan__count">
          {items.length} project{items.length === 1 ? "" : "s"} · {backedUp} backed up
        </span>
        {showProgress && (
          <div style={{ flexBasis: "100%", marginTop: 4 }}>
            {scan.phase === "searching" || (!scan.phase && scanning) ? (
              <>
                <div className="sub" style={{ margin: "0 0 6px", fontSize: 12.5 }}>
                  🔎 Searching… {scan.dirs.toLocaleString()} folders · {scan.found} project{scan.found === 1 ? "" : "s"} found
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div className="seg" role="group">
            <button className={`seg__opt${filter === "all" ? " seg__opt--on" : ""}`} onClick={() => setFilter("all")}>
              All ({items.length})
            </button>
            <button className={`seg__opt${filter === "attention" ? " seg__opt--on" : ""}`} onClick={() => setFilter("attention")}>
              Needs a look ({attentionCount})
            </button>
          </div>
          {attentionCount > 0 && (
            <button className="btn-blue" onClick={fixAll} disabled={fixingAll} style={{ marginLeft: "auto" }}
              title="Back up every project with missing samples, searching your sample folders for them">
              {fixingAll ? "Looking for samples…" : `Find missing samples (${attentionCount})`}
            </button>
          )}
          {notice && <p className="lib-notice" style={{ flexBasis: "100%" }}>{notice}</p>}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading your library…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><SlothMascot label="Nothing scanned yet" /></div>
          Nothing scanned yet — pick a scope above and hit “Scan now”.
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><SlothMascot label="All clear" /></div>
          Nothing needs a look — every project’s samples are accounted for.
        </div>
      ) : (
        owners.map((owner) => {
          const list = byOwner[owner];
          const isCollapsed = collapsed[owner];
          const ownerBacked = list.filter((i) => i.backed_up).length;
          return (
            <div key={owner} style={{ marginBottom: 14 }}>
              {owners.length > 1 && (
                <div className="foldergroup__head">
                  <button className="foldergroup__title" onClick={() => setCollapsed((c) => ({ ...c, [owner]: !c[owner] }))}>
                    <span>{isCollapsed ? "▸" : "▾"}</span>
                    <span>👤 {ownerLabel(owner)}</span>
                    <span className="sub">{list.length} project{list.length === 1 ? "" : "s"} · {ownerBacked} backed up</span>
                  </button>
                </div>
              )}
              {!isCollapsed && (
                <div className="cols cols-head lib-cols" aria-hidden>
                  <span /><span /><span>Project</span><span>Status</span><span className="col-num">Last backup</span><span className="col-num">Size</span><span /><span /><span />
                </div>
              )}
              {!isCollapsed && list.map((it) => {
                const working = busy.has(it.project_id);
                const st = statusLine(it);
                const dawName = it.daw === "flstudio" ? "FL Studio" : it.daw === "ableton" ? "Ableton Live" : "its DAW";
                const openIt = () => setExpanded(it.project_id);
                return (
                  <div key={it.project_id} data-pid={it.project_id} className="row cols lib-row lib-cols" role="button" tabIndex={0}
                    onClick={openIt}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIt(); } }}>
                    {it.latest_export
                      ? <PlayButton path={it.latest_export.path} title={it.latest_export.name} size={28} />
                      : <span className="playbtn-slot" aria-hidden />}
                    <span className={`lib-dot${st.tone === "ok" ? " lib-dot--ok" : st.tone === "warn" ? " lib-dot--warn" : ""}`} aria-hidden />
                    <div className="lib-name col-trunc" title={it.plugins?.length ? `Plugins: ${it.plugins.join(", ")}` : undefined}>{it.name}</div>
                    <div className={`lib-status col-trunc${st.tone === "warn" ? " lib-status--warn" : st.tone === "ok" ? " lib-status--ok" : ""}`}>
                      {working ? "Backing up…" : st.text}
                    </div>
                    <div className="lib-status col-num">{st.when}</div>
                    <div className="lib-status col-num">{st.size}</div>
                    <DawBadge daw={it.daw} />
                    {/* one main button: the thing this project most needs */}
                    <div className="col-act">
                    {it.missing_count > 0 ? (
                      <Button size="sm" disabled={working} onClick={(e) => { e.stopPropagation(); openIt(); }}
                        title="See which samples are missing and point me to them">Fix</Button>
                    ) : !it.backed_up ? (
                      <Button size="sm" disabled={working} onClick={(e) => { e.stopPropagation(); backupOne(it); }}>Back up</Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openInDaw(it.path); }}
                        title={`Open in ${dawName}`}>Open</Button>
                    )}
                    </div>
                    <RowMenu items={[
                      { label: `Open in ${dawName}`, onClick: () => openInDaw(it.path) },
                      { label: "Show backups & details", onClick: openIt },
                      { label: it.backed_up ? "Back up again" : "Back up", onClick: () => backupOne(it), disabled: working },
                      ...(it.missing_count > 0 ? [{ label: "Look for samples in a folder…", onClick: () => lookInFolder(it), disabled: working }] : []),
                      { label: `Show in ${osWords().fileManager}`, onClick: () => revealPath(it.path) },
                    ]} />
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </>
  );
}
