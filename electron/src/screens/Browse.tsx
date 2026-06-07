import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { ProjectRow, Snapshot, VerifyResult } from "../types";
import { StatusPill } from "../components/StatusPill";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { fmtSize, fmtDate, shortPath } from "../format";

const api = makeApi();

function reveal(dir?: string) {
  if (dir) (window as any).ablebackup?.revealPath?.(dir);
}

export function Browse() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [results, setResults] = useState<Record<number, VerifyResult>>({});
  const [verifying, setVerifying] = useState<Set<number>>(new Set());

  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, []);
  useEffect(() => {
    setSnaps([]); setResults({});
    if (active) api.projectDetail(active).then((d) => setSnaps(d.snapshots)).catch(() => {});
  }, [active]);

  async function verify(id: number) {
    setVerifying((s) => new Set(s).add(id));
    try {
      const r = await api.verify(id);
      setResults((m) => ({ ...m, [id]: r }));
      setSnaps((list) => list.map((s) => s.id === id ? { ...s, verified: r.ok ? 1 : 0, status: r.ok ? s.status : "error" } : s));
    } catch { /* surfaced as no result */ }
    finally { setVerifying((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }

  return (
    <>
      <PageHeader title="Browse backups" subtitle="Every dated snapshot, by project — reveal it, or verify it's complete." />
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18 }}>
        <div>
          {projects.length === 0 && <p className="sub">No backups yet.</p>}
          {projects.map((p) => (
            <button key={p.project_name} onClick={() => setActive(p.project_name)} className="row"
              style={{
                width: "100%", textAlign: "left", cursor: "pointer",
                background: active === p.project_name ? "var(--surface-2)" : "var(--surface)",
                borderColor: active === p.project_name ? "var(--accent)" : "var(--border)",
              }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project_name}</strong>
                <span className="sub" style={{ margin: 0 }}>
                  {p.snapshot_count} snapshot{p.snapshot_count === 1 ? "" : "s"} · {fmtSize(p.total_size)}
                </span>
              </div>
            </button>
          ))}
        </div>
        <div>
          {!active && <p className="sub">Select a project to see its history.</p>}
          {active && snaps.length === 0 && <p className="sub">No snapshots.</p>}
          {active && [...snaps].reverse().map((s) => {
            const r = results[s.id];
            const busy = verifying.has(s.id);
            return (
              <div key={s.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <strong>{fmtDate(s.timestamp)}{s.label ? ` · ${s.label}` : ""}</strong>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {!!s.verified && <span className="pill pill--ok">verified ✓</span>}
                    <StatusPill status={s.status} />
                    <Button variant="ghost" size="sm" onClick={() => verify(s.id)} disabled={busy}>
                      {busy ? "Verifying…" : "Verify"}
                    </Button>
                    {s.dir && <Button variant="ghost" size="sm" onClick={() => reveal(s.dir)}>Reveal</Button>}
                  </div>
                </div>
                <div className="sub" style={{ margin: "6px 0 0" }}>
                  {s.file_count} sample{s.file_count === 1 ? "" : "s"} · {fmtSize(s.total_size)}
                  {s.relinked_count ? ` · ${s.relinked_count} relinked` : ""}
                  {s.missing && s.missing.length > 0 ? ` · ${s.missing.length} missing` : ""}
                </div>

                {s.error && <div style={{ marginTop: 6, color: "var(--danger)", fontSize: 12 }}>{s.error}</div>}

                {r && (
                  <div className="card" style={{ marginTop: 10, background: "var(--surface-2)", padding: 12 }}>
                    {r.error ? (
                      <div style={{ color: "var(--warn)", fontSize: 12.5 }}>{r.error}</div>
                    ) : (
                      <>
                        <div style={{ color: r.ok ? "var(--accent-2)" : "var(--danger)", fontWeight: 600, fontSize: 13 }}>
                          {r.ok ? `✓ Verified — ${r.present}/${r.checked} files present, contents match` : `⚠ Problems found`}
                        </div>
                        {r.missing_files.length > 0 && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>Missing in backup: {r.missing_files.length}</div>}
                        {r.bad_files.length > 0 && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>Corrupted/changed: {r.bad_files.length}</div>}
                        <div className="sub" style={{ fontSize: 12, marginTop: 6 }}>
                          Opens standalone elsewhere: {r.portable_ok === null ? "—" : r.portable_ok ? "yes" : `no (${r.portable_missing.length} external sample(s) not embedded)`}
                        </div>
                        {r.relinked.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div className="sub" style={{ fontSize: 12, marginBottom: 4 }}>Auto-found from your library ({r.relinked.length}) — verify these are right:</div>
                            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: "var(--text-dim)" }}>
                              {r.relinked.slice(0, 12).map((x) => (
                                <li key={x.logical_path}><span style={{ color: "var(--accent-2)" }}>{x.logical_path}</span> ← {shortPath(x.source_path, 3)}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {s.missing && s.missing.length > 0 && (
                  <ul style={{ color: "var(--warn)", margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
                    {s.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
