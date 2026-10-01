import { useEffect, useMemo, useState } from "react";
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
import { MissingSamples } from "./MissingSamples";

const api = makeApi();

function fmtEta(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "";
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Scan reach — mirrors the backend scopes. "My folders" = the configured sources.
const SCOPES: { key: string; label: string }[] = [
  { key: "sources", label: "My folders" },
  { key: "home", label: "My whole Mac" },
  { key: "volumes", label: "+ External drives" },
];

function ownerLabel(owner: string): string {
  if (owner === "system") return "Other / system";
  return owner;
}

const bridge = () => (window as any).ablebackup;
const openInDaw = (p?: string) => { if (p) bridge()?.openProject?.(p); };
const revealPath = (p?: string) => { if (p) bridge()?.revealPath?.(p); };

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
      requestAnimationFrame(() => {
        document.querySelector(`[data-pid="${hit.project_id}"]`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    }
    onOpenHandled?.();
  }, [openProject, items]);

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
    setFixingAll(true); setErr(null);
    try {
      const { job_id } = await api.startBackup({
        als_paths: targets.map((t) => t.path), portable: true, layout: "project_date", find_missing: true,
      });
      for (;;) {
        const st = await api.jobStatus(job_id);
        if (st.state === "done" || st.state === "error") break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (e: any) { setErr(e.message || "Fix-all failed."); }
    finally { setFixingAll(false); load(); }
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

  return (
    <>
      <h1>Library</h1>
      <p className="sub">Every project a scan has found — backed up or not. Click one for details and its backups.</p>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="sub" style={{ margin: 0 }}>Scan</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={scanning}>
            {SCOPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Button onClick={runScan} disabled={scanning}>
            {scanning ? "Scanning your Mac…" : "Scan now"}
          </Button>
          <span className="sub mono" style={{ margin: 0, marginLeft: "auto" }}>
            {items.length} projects · {backedUp} backed up
          </span>
        </div>
        {showProgress && (
          <div style={{ marginTop: 12 }}>
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
        {scope !== "sources" && (
          <div className="sub" style={{ fontSize: 12, marginTop: 8 }}>
            Whole-Mac scans skip system, app & cache folders automatically. Big scopes can take a moment.
          </div>
        )}
        {(skipped > 0 || !fdaOk) && !scanning && (
          <div className="locked-note" style={{ marginTop: 10, flexDirection: "column", alignItems: "stretch", gap: 9 }}>
            <div style={{ fontSize: 12.5 }}>
              Skipped {skipped > 0 ? skipped.toLocaleString() + " " : ""}folder{skipped === 1 ? "" : "s"} that macOS hides
              (Documents / Desktop / Downloads) until you grant this app Full Disk Access.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="ghost" size="sm" onClick={() => (window as any).ablebackup?.openFdaSettings?.()}>
                Grant Full Disk Access
              </Button>
            </div>
          </div>
        )}
        {err && <div className="sub" style={{ color: "var(--danger)", marginTop: 8, fontSize: 12 }}>{err}</div>}
      </div>

      {!loading && items.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div className="seg" role="group">
            <button className={`seg__opt${filter === "all" ? " seg__opt--on" : ""}`} onClick={() => setFilter("all")}>
              All ({items.length})
            </button>
            <button className={`seg__opt${filter === "attention" ? " seg__opt--on" : ""}`} onClick={() => setFilter("attention")}>
              ⚠ Needs attention ({attentionCount})
            </button>
          </div>
          {attentionCount > 0 && (
            <button className="btn-blue" onClick={fixAll} disabled={fixingAll} style={{ marginLeft: "auto" }}
              title="Back up every project with missing samples, auto-finding from your libraries">
              {fixingAll ? "Fixing all…" : `Fix all ${attentionCount}`}
            </button>
          )}
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
          Nothing needs attention — every project’s samples are accounted for.
        </div>
      ) : (
        owners.map((owner) => {
          const list = byOwner[owner];
          const isCollapsed = collapsed[owner];
          const ownerBacked = list.filter((i) => i.backed_up).length;
          return (
            <div key={owner} style={{ marginBottom: 14 }}>
              <div className="foldergroup__head">
                <button className="foldergroup__title" onClick={() => setCollapsed((c) => ({ ...c, [owner]: !c[owner] }))}>
                  <span>{isCollapsed ? "▸" : "▾"}</span>
                  <span>👤 {ownerLabel(owner)}</span>
                  <span className="sub">{list.length} project{list.length === 1 ? "" : "s"} · {ownerBacked} backed up</span>
                </button>
              </div>
              {!isCollapsed && list.map((it) => {
                const working = busy.has(it.project_id);
                const open = expanded === it.project_id;
                return (
                  <div key={it.project_id} data-pid={it.project_id}>
                    <div className="row" role="button" tabIndex={0} style={{ cursor: "pointer" }}
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : it.project_id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(open ? null : it.project_id); } }}>
                      <DawBadge daw={it.daw} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                        <div className="sub mono" style={{ margin: 0, fontSize: 11.5 }}
                          title={it.plugins?.length ? `Plugins: ${it.plugins.join(", ")}` : undefined}>
                          {fmtSize(it.size)}
                          {it.tracks ? ` · ${it.tracks} track${it.tracks === 1 ? "" : "s"}` : ""}
                          {it.plugins?.length
                            ? ` · 🔌 ${it.plugins.slice(0, 3).join(", ")}${it.plugins.length > 3 ? ` +${it.plugins.length - 3}` : ""}`
                            : ""}
                          {it.missing_count > 0 ? ` · ${it.missing_count} missing` : ""}
                        </div>
                      </div>
                      {it.backed_up ? (
                        <span className="pill pill--ok" title={`Last backed up ${fmtDate(it.last_backup)}`}>
                          ✓ backed up · {fmtDate(it.last_backup)}
                        </span>
                      ) : (
                        <span className="pill">not backed up</span>
                      )}
                      <Button variant="ghost" size="sm"
                        onClick={(e) => { e.stopPropagation(); openInDaw(it.path); }}
                        title={`Open in ${it.daw === "flstudio" ? "FL Studio" : it.daw === "ableton" ? "Ableton Live" : "its DAW"}`}>
                        ▶ Open
                      </Button>
                      {it.missing_count > 0 && (
                        <Button variant="ghost" size="sm" disabled={working}
                          onClick={(e) => { e.stopPropagation(); lookInFolder(it); }}
                          title="Pick a folder you think these samples are in, and search there">
                          Look in a folder…
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" disabled={working}
                        onClick={(e) => { e.stopPropagation(); backupOne(it); }}>
                        {working ? "Backing up…" : it.backed_up ? "Back up again" : "Back up"}
                      </Button>
                    </div>
                    {open && (
                      <div style={{ margin: "8px 0 14px", display: "flex", flexDirection: "column", gap: 14 }}>
                        {/* missing samples first — it's the thing that needs a decision */}
                        {it.missing_count > 0 && (
                          <MissingSamples item={it} onChanged={load} />
                        )}
                        {/* the project as a record — vitals on the label, life on the timeline */}
                        <ProjectLabel item={it}
                          onOpenInDaw={() => openInDaw(it.path)}
                          onReveal={() => revealPath(it.path)} />
                        {/* Backups ARE this project's detail — actions live here. */}
                        {it.backed_up && (
                          <div className="card" style={{ padding: "14px 16px" }}>
                            <div className="sub" style={{ margin: "0 0 10px", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                              Backups
                            </div>
                            <ProjectBackups projectName={it.name} projectPath={it.path} onFixed={load} />
                          </div>
                        )}
                      </div>
                    )}
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
