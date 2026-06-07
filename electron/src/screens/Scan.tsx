import { useState } from "react";
import { makeApi } from "../api";
import type { ProjectSummary } from "../types";
import { Button } from "../components/Button";
import { fmtSize } from "../format";

const api = makeApi();

export function Scan({ projects, onProjects, onBackupStarted }: {
  projects: ProjectSummary[] | null;
  onProjects: (p: ProjectSummary[] | null) => void;
  onBackupStarted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function scan() {
    setBusy(true); setErr(null);
    try { onProjects(await api.scan()); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  async function backupAll() {
    setErr(null);
    try { await api.startBackup({}); onBackupStarted(); }
    catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <h1>Scan & Back up</h1>
      <p className="sub">Find projects in your source folders and back them up.</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
        <Button onClick={scan} disabled={busy}>{busy ? "Scanning…" : "Scan now"}</Button>
        {projects && projects.length > 0 &&
          <Button variant="primary" onClick={backupAll}>Back up all ({projects.length})</Button>}
      </div>
      {err && <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", marginBottom: 18 }}>{err}</div>}
      {projects && projects.length === 0 && <p className="sub">No projects found. Check your source folders.</p>}
      {projects && projects.map((p) => (
        <div key={p.als_path} className="card" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
          <div>
            <strong>{p.name}</strong>
            <div className="sub" style={{ margin: 0 }}>{p.project_dir}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>{p.present_count} files · {fmtSize(p.total_size)}</div>
            {p.missing_count > 0 &&
              <div style={{ color: "var(--warn)" }}>{p.missing_count} missing</div>}
          </div>
        </div>
      ))}
    </>
  );
}
