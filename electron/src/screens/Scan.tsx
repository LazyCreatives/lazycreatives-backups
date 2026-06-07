import { useEffect, useRef, useState } from "react";
import { makeApi } from "../api";
import type { ProjectSummary } from "../types";
import type { ScanProgress } from "../useProgress";
import type { PendingBackup } from "../App";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { ProgressBar } from "../components/ProgressBar";
import { fmtSize, dawLabel } from "../format";

const api = makeApi();

export function Scan({ projects, onProjects, scan, onReview }: {
  projects: ProjectSummary[] | null;
  onProjects: (p: ProjectSummary[] | null) => void;
  scan: ScanProgress;
  onReview: (p: PendingBackup) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [findMissing, setFindMissing] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);

  // Keep the user's curation across rescans: previously-deselected projects stay
  // off, and newly-discovered projects default to selected.
  useEffect(() => {
    if (!projects) return;
    const current = projects.map((p) => p.als_path);
    setSelected((prev) => {
      if (known.current === null) return new Set(current); // first scan: all on
      const next = new Set<string>();
      for (const a of current) {
        if (!known.current.has(a) || prev.has(a)) next.add(a);
      }
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
  function review() {
    if (!projects) return;
    const chosen = projects.filter((p) => selected.has(p.als_path));
    onReview({
      als_paths: chosen.map((p) => p.als_path),
      count: chosen.length,
      size: chosen.reduce((a, p) => a + p.total_size, 0),
      findMissing,
    });
  }
  const relinkedTotal = projects ? projects.reduce((a, p) => a + (p.relinked_count || 0), 0) : 0;

  function toggle(als: string) {
    setSelected((s) => { const n = new Set(s); n.has(als) ? n.delete(als) : n.add(als); return n; });
  }
  function toggleExpand(als: string) {
    setExpanded((s) => { const n = new Set(s); n.has(als) ? n.delete(als) : n.add(als); return n; });
  }
  const allSelected = !!projects && projects.length > 0 && selected.size === projects.length;
  function selectAll() {
    if (!projects) return;
    setSelected(allSelected ? new Set() : new Set(projects.map((p) => p.als_path)));
  }
  const selectedSize = projects
    ? projects.filter((p) => selected.has(p.als_path)).reduce((a, p) => a + p.total_size, 0) : 0;

  const scanning = busy || scan.active;

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
            {projects && projects.length > 0 && (
              <Button onClick={review} disabled={selected.size === 0}>
                Back up {allSelected ? "all" : selected.size} · {fmtSize(selectedSize)}
              </Button>
            )}
          </>
        }
      />

      {err && <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", marginBottom: 16 }}>{err}</div>}

      <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 14px", color: "var(--text-dim)", fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={findMissing} onChange={(e) => setFindMissing(e.target.checked)} />
        Find missing samples in my Splice library
        {relinkedTotal > 0 && <span style={{ color: "var(--accent-2)" }}>· {relinkedTotal} relinked</span>}
      </label>

      {scanning && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
            <span>Scanning projects…</span>
            <span className="sub mono" style={{ margin: 0 }}>
              {scan.total ? `${scan.done} / ${scan.total}` : "starting…"}
            </span>
          </div>
          <ProgressBar value={scan.done} max={scan.total} active />
          {scan.current && <div className="sub" style={{ margin: "8px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{scan.current}</div>}
        </div>
      )}

      {!projects && !scanning && <div className="empty"><div className="empty__icon">🔍</div>Hit “Scan now” to discover projects in your source folders.</div>}
      {projects && projects.length === 0 && !scanning && <div className="empty"><div className="empty__icon">📁</div>No projects found. Check your folders in Sources &amp; NAS.</div>}

      {projects && projects.length > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 12px", color: "var(--text-dim)", fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={allSelected} onChange={selectAll} />
          {selected.size} of {projects.length} selected
        </label>
      )}

      {projects && projects.map((p) => {
        const isSel = selected.has(p.als_path);
        const isOpen = expanded.has(p.als_path);
        return (
          <div key={p.als_path} className="row" style={{ alignItems: "flex-start", opacity: isSel ? 1 : 0.5 }}>
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
              <div className="sub" style={{ margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project_dir}</div>
              {p.relinked_count > 0 && (
                <div style={{ marginTop: 5, color: "var(--accent-2)", fontSize: 12 }}>
                  ✓ {p.relinked_count} relinked from library
                </div>
              )}
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
    </>
  );
}
