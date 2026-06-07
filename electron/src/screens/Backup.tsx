import { useEffect, useState } from "react";
import type { BackupProgress } from "../useProgress";
import { ProgressBar } from "../components/ProgressBar";
import { PageHeader } from "../components/PageHeader";
import { makeApi } from "../api";
import type { Snapshot } from "../types";
import { fmtDate } from "../format";

const api = makeApi();

export function Backup({ progress: p }: { progress: BackupProgress }) {
  const [last, setLast] = useState<Snapshot | null>(null);
  const idle = !p.active && !p.done && p.total === 0;

  useEffect(() => {
    if (idle) api.history(1).then((h) => setLast(h[0] ?? null)).catch(() => {});
  }, [idle]);

  const subtitle = p.preparing ? "Preparing…"
    : p.active && p.current ? `Backing up ${p.current}…`
    : p.active ? "Working…"
    : p.done ? "Complete." : "No backup running.";
  const doneCount = p.completed + p.skipped + p.errors;

  return (
    <>
      <PageHeader title="Backup progress" subtitle={subtitle} />

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
              : p.log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </>
      )}
    </>
  );
}
