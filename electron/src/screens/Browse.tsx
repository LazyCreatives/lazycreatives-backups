import { useEffect, useMemo, useState } from "react";
import { makeApi } from "../api";
import type { ProjectRow, Snapshot, VerifyResult, SnapshotFile, SnapshotFilesResult } from "../types";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { VerifiedSeal } from "../components/VerifiedSeal";
import { fmtSize, fmtDate, shortPath, dawLabel, sourceLabel } from "../format";

const api = makeApi();
function reveal(p?: string) { if (p) (window as any).ablebackup?.revealPath?.(p); }

function FileGroup({ label, icon, files, snapDir, open, toggle, showSource }: {
  label: string; icon: string; files: SnapshotFile[]; snapDir?: string;
  open: boolean; toggle: () => void; showSource?: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <button className="filegroup__head" onClick={toggle}>
        <span>{open ? "▾" : "▸"} {icon} {label}</span>
        <span className="sub mono" style={{ margin: 0 }}>{files.length}</span>
      </button>
      {open && files.map((f) => {
        const name = f.logical_path.split("/").pop();
        return (
          <div key={f.logical_path} className="filerow" title={snapDir ? "Reveal in the backup" : undefined}
            onClick={() => reveal(snapDir ? `${snapDir}/${f.logical_path}` : undefined)}>
            <span className="filerow__name">{name}</span>
            {f.relinked && <span className="pill pill--ok filerow__tag">auto-found</span>}
            {showSource && <span className="filerow__src">← {sourceLabel(f.source_path)}</span>}
            <span className="filerow__size mono">{fmtSize(f.size)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Browse() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [query, setQuery] = useState("");
  const [dawFilter, setDawFilter] = useState("all");
  const [active, setActive] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [files, setFiles] = useState<SnapshotFilesResult | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ project: true, gathered: true, internal: false });
  const [results, setResults] = useState<Record<number, VerifyResult>>({});
  const [verifying, setVerifying] = useState<Set<number>>(new Set());
  const [restoring, setRestoring] = useState<Set<number>>(new Set());
  const [restored, setRestored] = useState<Record<number, { path?: string; error?: string }>>({});

  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, []);
  useEffect(() => {
    setSnaps([]); setSelId(null); setFiles(null);
    if (active) api.projectDetail(active).then((d) => {
      setSnaps(d.snapshots);
      const newest = d.snapshots[d.snapshots.length - 1];
      if (newest) setSelId(newest.id);
    }).catch(() => {});
  }, [active]);
  useEffect(() => {
    if (selId == null) { setFiles(null); return; }
    setLoadingFiles(true);
    api.snapshotFiles(selId).then(setFiles).catch(() => setFiles(null)).finally(() => setLoadingFiles(false));
  }, [selId]);

  const daws = useMemo(() => Array.from(new Set(projects.map((p) => p.daw).filter(Boolean))) as string[], [projects]);
  const filtered = projects.filter((p) =>
    (dawFilter === "all" || p.daw === dawFilter) &&
    p.project_name.toLowerCase().includes(query.toLowerCase()));
  const sel = snaps.find((s) => s.id === selId) || null;

  const groups = useMemo(() => {
    const fs = files?.files ?? [];
    return {
      project: fs.filter((f) => f.inside_project && !f.logical_path.includes("/")),
      internal: fs.filter((f) => f.inside_project && f.logical_path.includes("/")),
      gathered: fs.filter((f) => !f.inside_project),
    };
  }, [files]);
  const locations = useMemo(
    () => new Set(groups.gathered.map((f) => sourceLabel(f.source_path))).size, [groups]);

  async function verify(id: number) {
    setVerifying((s) => new Set(s).add(id));
    try {
      const r = await api.verify(id);
      setResults((m) => ({ ...m, [id]: r }));
      setSnaps((list) => list.map((s) => s.id === id ? { ...s, verified: r.ok ? 1 : 0 } : s));
    } catch { /* surfaced as no result */ }
    finally { setVerifying((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }
  async function restore(id: number) {
    const target = await (window as any).ablebackup?.pickFolder?.();
    if (!target) return;
    setRestoring((s) => new Set(s).add(id));
    setRestored((m) => { const n = { ...m }; delete n[id]; return n; });
    try {
      const { job_id } = await api.restore(id, target);
      let res = await api.jobStatus(job_id);
      for (let i = 0; i < 1200 && res.state === "running"; i++) {
        await new Promise((r) => setTimeout(r, 500));
        res = await api.jobStatus(job_id);
      }
      setRestored((m) => ({ ...m, [id]: res.state === "done" ? { path: res.result?.path } : { error: res.error || "restore failed" } }));
    } catch (e: any) {
      setRestored((m) => ({ ...m, [id]: { error: e.message } }));
    } finally {
      setRestoring((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  const r = selId != null ? results[selId] : undefined;
  const rest = selId != null ? restored[selId] : undefined;

  return (
    <>
      <PageHeader title="History" subtitle="Every backup — and everything we gathered and tidied inside it." />

      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <input className="input" placeholder="Search projects…" value={query}
          onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, maxWidth: 280 }} />
        {daws.length > 1 && (
          <div className="seg">
            <button className={`seg__opt${dawFilter === "all" ? " seg__opt--on" : ""}`} onClick={() => setDawFilter("all")}>All</button>
            {daws.map((d) => (
              <button key={d} className={`seg__opt${dawFilter === d ? " seg__opt--on" : ""}`} onClick={() => setDawFilter(d)}>{dawLabel(d)}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "calc(100vh - 230px)", overflow: "auto" }}>
          {filtered.length === 0 && <p className="sub">No projects.</p>}
          {filtered.map((p) => (
            <button key={p.project_name} onClick={() => setActive(p.project_name)} className="row"
              style={{
                width: "100%", textAlign: "left", cursor: "pointer",
                background: active === p.project_name ? "var(--surface-2)" : "var(--surface)",
                borderColor: active === p.project_name ? "var(--accent)" : "var(--border)",
              }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
                  <span className="daw-badge">{dawLabel(p.daw)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project_name}</span>
                </strong>
                <span className="sub" style={{ margin: 0 }}>
                  {p.snapshot_count} snapshot{p.snapshot_count === 1 ? "" : "s"} · {fmtSize(p.total_size)}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div>
          {!active && <div className="empty"><div className="empty__icon">🗂️</div>Pick a project to explore its backups.</div>}
          {active && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {[...snaps].reverse().map((s) => (
                  <button key={s.id} onClick={() => setSelId(s.id)}
                    className={`snapchip${selId === s.id ? " snapchip--on" : ""}`}>
                    {fmtDate(s.timestamp)}{s.verified ? " ✓" : ""}
                  </button>
                ))}
              </div>

              {sel && (
                <div className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 15 }}>{fmtDate(sel.timestamp)}{sel.label ? ` · ${sel.label}` : ""}</strong>
                      <div className="sub" style={{ margin: "5px 0 0", fontSize: 12.5 }}>
                        {sel.file_count} file{sel.file_count === 1 ? "" : "s"} · {fmtSize(sel.total_size)}
                        {groups.gathered.length > 0 && (
                          <> · <span style={{ color: "var(--accent)" }}>{groups.gathered.length} gathered from {locations} location{locations === 1 ? "" : "s"}</span></>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", flexShrink: 0 }}>
                      {!!sel.verified && <span className="pill pill--ok">verified ✓</span>}
                      {files?.portable && <span className="pill">portable</span>}
                      <Button size="sm" variant="ghost" onClick={() => verify(sel.id)} disabled={verifying.has(sel.id)}>{verifying.has(sel.id) ? "Verifying…" : "Verify"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => restore(sel.id)} disabled={restoring.has(sel.id)}>{restoring.has(sel.id) ? "Restoring…" : "Restore"}</Button>
                      {sel.dir && <Button size="sm" variant="ghost" onClick={() => reveal(sel.dir)}>Reveal</Button>}
                    </div>
                  </div>

                  {rest && (
                    <div className="card" style={{ marginBottom: 12, background: "var(--surface-2)", padding: 11, fontSize: 12.5 }}>
                      {rest.error ? <span style={{ color: "var(--danger)" }}>Restore failed: {rest.error}</span>
                        : <span><span style={{ color: "var(--accent-2)", fontWeight: 600 }}>✓ Restored</span> to {shortPath(rest.path || "", 4)}
                          {rest.path && <Button variant="ghost" size="sm" style={{ marginLeft: 10 }} onClick={() => reveal(rest.path)}>Reveal</Button>}</span>}
                    </div>
                  )}
                  {r && !r.error && (
                    <div className="card" style={{ marginBottom: 12, background: "var(--surface-2)", padding: 11, display: "flex", alignItems: "center", gap: 12 }}>
                      {r.ok ? <VerifiedSeal size={40} /> : <span style={{ fontSize: 22 }}>⚠</span>}
                      <div style={{ fontSize: 12.5 }}>
                        <div style={{ color: r.ok ? "var(--accent-2)" : "var(--danger)", fontWeight: 700 }}>
                          {r.ok ? "Verified" : "Problems found"}
                        </div>
                        <div className="sub" style={{ margin: 0 }}>
                          {r.present}/{r.checked} files present, contents match
                          {r.bad_files.length > 0 ? ` · ${r.bad_files.length} corrupted` : ""}
                        </div>
                      </div>
                    </div>
                  )}

                  {loadingFiles && <p className="sub">Reading the backup…</p>}
                  {!loadingFiles && files && !files.manifest_present && (
                    <p className="sub">File details weren't recorded for this older backup — use Reveal to open it in Finder.</p>
                  )}
                  {!loadingFiles && files?.manifest_present && (
                    <div className="filebrowser">
                      <FileGroup label="Project" icon="🎛️" files={groups.project} snapDir={sel.dir}
                        open={open.project} toggle={() => setOpen((g) => ({ ...g, project: !g.project }))} />
                      <FileGroup label="Gathered samples" icon="📥" files={groups.gathered} snapDir={sel.dir} showSource
                        open={open.gathered} toggle={() => setOpen((g) => ({ ...g, gathered: !g.gathered }))} />
                      <FileGroup label="In-project samples" icon="📁" files={groups.internal} snapDir={sel.dir}
                        open={open.internal} toggle={() => setOpen((g) => ({ ...g, internal: !g.internal }))} />
                    </div>
                  )}

                  {sel.missing && sel.missing.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="sub" style={{ color: "var(--warn)", fontSize: 12, marginBottom: 4 }}>⚠ {sel.missing.length} sample(s) couldn't be found at backup time:</div>
                      <ul style={{ color: "var(--warn)", margin: 0, paddingLeft: 18, fontSize: 12 }}>
                        {sel.missing.slice(0, 20).map((m) => <li key={m}>{m}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
