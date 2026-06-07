import { useEffect, useState } from "react";
import type { BackupProgress } from "../useProgress";
import { ProgressBar } from "../components/ProgressBar";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { VerifiedSeal } from "../components/VerifiedSeal";
import { CountUp } from "../components/CountUp";
import { makeApi } from "../api";
import type { Snapshot } from "../types";
import { fmtDate } from "../format";

const api = makeApi();

export function Backup({ progress: p, jobId }: { progress: BackupProgress; jobId: string | null }) {
  const [last, setLast] = useState<Snapshot | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const idle = !p.active && !p.done && p.total === 0;

  useEffect(() => {
    if (idle) api.history(1).then((h) => setLast(h[0] ?? null)).catch(() => {});
  }, [idle]);

  // Reset the cancelling flag once a run is no longer active.
  useEffect(() => { if (!p.active) setCancelling(false); }, [p.active]);

  async function cancel() {
    if (!jobId) return;
    setCancelling(true);
    try { await api.cancelJob(jobId); } catch { setCancelling(false); }
  }

  const subtitle = p.preparing ? "Preparing…"
    : p.active && p.current ? `Backing up ${p.current}…`
    : p.active ? "Working…"
    : p.cancelled ? "Cancelled."
    : p.done ? "Complete." : "No backup running.";
  const doneCount = p.completed + p.skipped + p.errors;

  return (
    <>
      <PageHeader
        title="Backup progress"
        subtitle={subtitle}
        actions={p.active && jobId ? (
          <Button variant="danger" onClick={cancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        ) : undefined}
      />

      {idle ? (
        <div className="card">
          {last ? (
            <>
              <h2>Last backup</h2>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{last.project_name}{last.label ? ` · ${last.label}` : ""}</strong>
                <span className="sub" style={{ margin: 0 }}>{fmtDate(last.timestamp)}</span>
              </div>
              <p className="sub" style={{ margin: "10px 0 0" }}>Start a new backup from Scan &amp; Back up.</p>
            </>
          ) : (
            <div className="empty"><div className="empty__icon">💤</div>No backups yet. Start one from Scan &amp; Back up.</div>
          )}
        </div>
      ) : (
        <>
          {p.done && !p.cancelled && (
            <div className="card celebrate" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16 }}>
              <VerifiedSeal size={54} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: "var(--accent-2)" }}>Backed up &amp; verified</div>
                <div className="sub" style={{ margin: "4px 0 0" }}>
                  <CountUp value={p.completed} format={(n) => `${Math.round(n)}`} /> project{p.completed === 1 ? "" : "s"} protected
                  {p.skipped > 0 ? ` · ${p.skipped} unchanged` : ""}
                  {p.errors > 0 ? ` · ${p.errors} error(s)` : ""}
                </div>
              </div>
            </div>
          )}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
              <span className="mono">{p.preparing ? "Preparing…" : `${doneCount} / ${p.total}`}</span>
              <span className="sub" style={{ margin: 0, display: "flex", gap: 12 }}>
                {p.skipped > 0 && <span>↷ {p.skipped} unchanged</span>}
                {p.errors > 0 && <span style={{ color: "var(--danger)" }}>{p.errors} error(s)</span>}
                {p.done && <span>done</span>}
              </span>
            </div>
            <ProgressBar value={p.preparing ? 1 : doneCount} max={p.preparing ? 1 : p.total} active={p.active} />
          </div>
          <div className="card" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.7, maxHeight: 360, overflow: "auto" }}>
            {p.log.length === 0
              ? <span className="sub">Waiting for the first project…</span>
              : p.log.map((line, i) => <div key={i} className="logline">{line}</div>)}
          </div>
        </>
      )}
    </>
  );
}
