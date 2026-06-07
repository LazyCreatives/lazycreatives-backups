import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { ProjectRow, Snapshot } from "../types";
import { StatusPill } from "../components/StatusPill";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { fmtSize, fmtDate } from "../format";

const api = makeApi();

function reveal(dir?: string) {
  if (dir) (window as any).ablebackup?.revealPath?.(dir);
}

export function Browse() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);

  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, []);
  useEffect(() => {
    if (active) api.projectDetail(active).then((d) => setSnaps(d.snapshots)).catch(() => {});
    else setSnaps([]);
  }, [active]);

  return (
    <>
      <PageHeader title="Browse backups" subtitle="Every dated snapshot, by project — open any one straight on your NAS." />
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 18 }}>
        <div>
          {projects.length === 0 && <p className="sub">No backups yet.</p>}
          {projects.map((p) => (
            <button key={p.project_name} onClick={() => setActive(p.project_name)} className="row"
              style={{
                width: "100%", textAlign: "left", cursor: "pointer",
                background: active === p.project_name ? "var(--bg-elev-2)" : "var(--bg-elev)",
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
          {active && [...snaps].reverse().map((s) => (
            <div key={s.id} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <strong>{fmtDate(s.timestamp)}{s.label ? ` · ${s.label}` : ""}</strong>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <StatusPill status={s.status} />
                  {s.dir && <Button variant="ghost" onClick={() => reveal(s.dir)}>Reveal</Button>}
                </div>
              </div>
              <div className="sub" style={{ margin: "6px 0 0" }}>
                {s.file_count} sample{s.file_count === 1 ? "" : "s"} · {fmtSize(s.total_size)}
                {s.missing && s.missing.length > 0 ? ` · ${s.missing.length} missing` : ""}
              </div>
              {s.error && <div className="badge-warn" style={{ marginTop: 6, color: "var(--danger)" }}>{s.error}</div>}
              {s.missing && s.missing.length > 0 && (
                <ul style={{ color: "var(--warn)", margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }}>
                  {s.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
