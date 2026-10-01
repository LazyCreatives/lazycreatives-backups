import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { makeApi } from "../api";
import type { ProjectSummary } from "../types";
import type { ScanProgress } from "../useProgress";
import type { PendingBackup } from "../App";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { ProBadge } from "../components/ProBadge";
import { useEntitlement } from "../entitlement";
import { fmtSize, dawLabel } from "../format";

const api = makeApi();
type SortKey = "name" | "recent" | "size" | "issues";

export function Scan({ projects, onProjects, scan, onBackup, onReview }: {
  projects: ProjectSummary[] | null;
  onProjects: (p: ProjectSummary[] | null) => void;
  scan: ScanProgress;
  onBackup: (p: PendingBackup) => void;
  onReview: (p: PendingBackup) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [findMissing, setFindMissing] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [groupByFolder, setGroupByFolder] = useState(true);
  const [hideAutosaves, setHideAutosaves] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const { allows } = useEntitlement();
  const canRelink = allows("auto_relink");

  // Keep the user's curation across rescans: previously-deselected projects stay
  // off, and newly-discovered projects default to selected.
  useEffect(() => {
    if (!projects) return;
    const current = projects.map((p) => p.als_path);
    setSelected((prev) => {
      if (known.current === null) return new Set(current);
      const next = new Set<string>();
      for (const a of current) if (!known.current.has(a) || prev.has(a)) next.add(a);
      return next;
    });
    known.current = new Set(current);
  }, [projects]);

  async function runScan() {
    setBusy(true); setErr(null);
    try { onProjects(await api.scan(undefined, findMissing)); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // search + autosave filter + sort
  const visible = useMemo(() => {
    if (!projects) return [];
    let v = projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
    if (hideAutosaves) v = v.filter((p) => !p.name.toLowerCase().includes("autosav"));
    const cmp: Record<SortKey, (a: ProjectSummary, b: ProjectSummary) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      recent: (a, b) => b.mtime - a.mtime,
      size: (a, b) => b.total_size - a.total_size,
      issues: (a, b) => b.missing_count - a.missing_count || a.name.localeCompare(b.name),
    };
    return [...v].sort(cmp[sortKey]);
  }, [projects, query, hideAutosaves, sortKey]);

  // group by project folder
  const groups = useMemo(() => {
    if (!groupByFolder) return [{ key: "__all__", dir: "", label: "", items: visible }];
    const map = new Map<string, ProjectSummary[]>();
    for (const p of visible) (map.get(p.project_dir) ?? map.set(p.project_dir, []).get(p.project_dir)!).push(p);
    return Array.from(map.entries()).map(([dir, items]) => ({
      key: dir, dir, items,
      label: (dir.split(/[/\\]/).pop() || dir).replace(/ Project$/i, ""),
    }));
  }, [visible, groupByFolder]);

  const hiddenCount = (projects?.length ?? 0) - visible.length;
  const selectedSize = visible.filter((p) => selected.has(p.als_path)).reduce((a, p) => a + p.total_size, 0);
  const selectedVisible = visible.filter((p) => selected.has(p.als_path)).length;
  const selectedTotalSize = (projects ?? []).filter((p) => selected.has(p.als_path)).reduce((a, p) => a + p.total_size, 0);
  const relinkedTotal = projects ? projects.reduce((a, p) => a + (p.relinked_count || 0), 0) : 0;

  function toggle(als: string) {
    setSelected((s) => { const n = new Set(s); n.has(als) ? n.delete(als) : n.add(als); return n; });
  }
  function setMany(items: ProjectSummary[], on: boolean) {
    setSelected((s) => { const n = new Set(s); for (const p of items) on ? n.add(p.als_path) : n.delete(p.als_path); return n; });
  }
  function toggleExpand(als: string) {
    setExpanded((s) => { const n = new Set(s); n.has(als) ? n.delete(als) : n.add(als); return n; });
  }
  function toggleCollapse(key: string) {
    setCollapsed((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  const allVisibleSelected = visible.length > 0 && selectedVisible === visible.length;

  function buildPending(): PendingBackup {
    const chosen = (projects ?? []).filter((p) => selected.has(p.als_path));
    return {
      als_paths: chosen.map((p) => p.als_path),
      count: chosen.length,
      size: chosen.reduce((a, p) => a + p.total_size, 0),
      findMissing,
    };
  }

  const scanning = busy || scan.active;
  const hasProjects = projects && projects.length > 0;

  return (
    <>
      <PageHeader
        title="Scan & Back up"
        subtitle="Find your projects, pick which to protect, then review and back them up."
        actions={
          <>
            <Button variant="ghost" onClick={runScan} disabled={scanning}>
              {scanning ? "Scanning…" : projects ? "Rescan" : "Scan now"}
            </Button>
            {hasProjects && (
              <>
                <Button variant="ghost" size="sm" onClick={() => onReview(buildPending())} disabled={selected.size === 0}>Options…</Button>
                <Button onClick={() => onBackup(buildPending())} disabled={selected.size === 0}>
                  Back up {selected.size} · {fmtSize(selectedTotalSize)}
                </Button>
              </>
            )}
          </>
        }
      />

      {err && <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", marginBottom: 16 }}>{err}</div>}

      <label className={canRelink ? "" : "locked"} style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 14px", color: "var(--text-dim)", fontSize: 13, cursor: canRelink ? "pointer" : "default" }}>
        <input type="checkbox" checked={findMissing && canRelink} disabled={!canRelink} onChange={(e) => setFindMissing(e.target.checked)} />
        Auto-find missing samples in my library
        {!canRelink && <ProBadge />}
        {relinkedTotal > 0 && <span style={{ color: "var(--accent-2)" }}>· {relinkedTotal} auto-found</span>}
      </label>

      {scanning && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
            <span className="sonar"><span /><span /><span className="sonar__dot" /></span>
            <span style={{ flex: 1 }}>Scanning projects…</span>
            <span className="sub mono" style={{ margin: 0 }}>{scan.total ? `${scan.done} / ${scan.total}` : "starting…"}</span>
          </div>
          <ProgressBar value={scan.done} max={scan.total} active />
          {scan.current && <div className="sub" style={{ margin: "8px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scan.current}</div>}
        </div>
      )}

      {!projects && !scanning && <div className="empty"><div className="empty__icon">🔍</div>Hit “Scan now” to discover projects in your source folders.</div>}
      {projects && projects.length === 0 && !scanning && <div className="empty"><div className="empty__icon">📁</div>No projects found. Check your folders in Settings.</div>}

      {hasProjects && (
        <>
          {/* toolbar */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <input className="input" placeholder="Search projects…" value={query}
              onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 180, maxWidth: 280 }} />
            <select className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ width: "auto" }}>
              <option value="recent">Recently modified</option>
              <option value="name">Name (A–Z)</option>
              <option value="size">Size</option>
              <option value="issues">Missing samples</option>
            </select>
            <label className="toolchk"><input type="checkbox" checked={groupByFolder} onChange={(e) => setGroupByFolder(e.target.checked)} /> Group by folder</label>
            <label className="toolchk"><input type="checkbox" checked={hideAutosaves} onChange={(e) => setHideAutosaves(e.target.checked)} /> Hide autosaves</label>
          </div>

          {/* selection bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 2px 12px", color: "var(--text-dim)", fontSize: 13 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={allVisibleSelected} onChange={() => setMany(visible, !allVisibleSelected)} />
              {selectedVisible} of {visible.length} selected{query || hideAutosaves ? " (matching)" : ""}
            </label>
            {hiddenCount > 0 && <span className="sub" style={{ margin: 0 }}>· {hiddenCount} hidden</span>}
            <span style={{ marginLeft: "auto" }}>{fmtSize(selectedSize)} selected</span>
          </div>

          {/* groups */}
          {groups.map((g) => {
            const open = !collapsed.has(g.key);
            const groupSel = g.items.filter((p) => selected.has(p.als_path)).length;
            const allSel = g.items.length > 0 && groupSel === g.items.length;
            const groupSize = g.items.reduce((a, p) => a + p.total_size, 0);
            return (
              <div key={g.key} style={{ marginBottom: groupByFolder ? 6 : 0 }}>
                {groupByFolder && (
                  <div className="foldergroup__head">
                    <input type="checkbox" checked={allSel} ref={(el) => { if (el) el.indeterminate = groupSel > 0 && !allSel; }}
                      onChange={() => setMany(g.items, !allSel)} onClick={(e) => e.stopPropagation()} />
                    <button className="foldergroup__title" onClick={() => toggleCollapse(g.key)}>
                      {open ? "▾" : "▸"} 📁 {g.label}
                      <span className="sub mono" style={{ margin: 0 }}>{g.items.length} · {fmtSize(groupSize)}</span>
                    </button>
                  </div>
                )}
                {open && g.items.map((p, i) => {
                  const isSel = selected.has(p.als_path);
                  const isOpen = expanded.has(p.als_path);
                  return (
                    <div key={p.als_path} className="row scanrow--enter"
                      style={{ "--i": Math.min(i, 14), alignItems: "flex-start", opacity: isSel ? 1 : 0.5, marginLeft: groupByFolder ? 18 : 0 } as CSSProperties}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(p.als_path)} style={{ marginTop: 3 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
                            <span className="daw-badge">{dawLabel(p.daw)}</span>{p.name}
                          </strong>
                          <span className="sub mono" style={{ margin: 0, whiteSpace: "nowrap" }}>
                            {p.present_count} sample{p.present_count === 1 ? "" : "s"} · {fmtSize(p.total_size)}
                          </span>
                        </div>
                        {!groupByFolder && <div className="sub" style={{ margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project_dir}</div>}
                        {p.relinked_count > 0 && <div style={{ marginTop: 5, color: "var(--accent-2)", fontSize: 12 }}>✓ {p.relinked_count} auto-found in your library</div>}
                        {p.missing_count > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <button className="linkbtn badge-warn" onClick={() => toggleExpand(p.als_path)}>
                              ⚠ {p.missing_count} missing sample{p.missing_count === 1 ? "" : "s"} {isOpen ? "▲" : "▼"}
                            </button>
                            {isOpen && (
                              <ul style={{ color: "var(--warn)", margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
                                {p.missing.map((m) => <li key={m}>{m}</li>)}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {visible.length === 0 && <p className="sub">No projects match “{query}”.</p>}
        </>
      )}
    </>
  );
}
