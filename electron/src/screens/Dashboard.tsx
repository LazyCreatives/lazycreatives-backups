import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Overview } from "../types";
import type { Screen } from "../App";
import { Button } from "../components/Button";
import { fmtSize, fmtDate, fmtInterval, shortPath } from "../format";

const api = makeApi();

function Tile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: string;
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-dim)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: tone }}>{value}</div>
      {hint && <div className="sub" style={{ margin: "2px 0 0" }}>{hint}</div>}
    </div>
  );
}

export function Dashboard({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const [ov, setOv] = useState<Overview | null>(null);
  useEffect(() => { api.overview().then(setOv).catch(() => {}); }, []);

  if (!ov) return (<><h1>Dashboard</h1><p className="sub">Loading…</p></>);

  const savedPct = ov.logical_size > 0 ? Math.round((ov.saved_bytes / ov.logical_size) * 100) : 0;
  const empty = ov.snapshot_count === 0;

  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">Your Ableton projects, backed up.</p>

      {empty ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <strong>No backups yet.</strong>
          <p className="sub" style={{ margin: "6px 0 14px" }}>
            {ov.nas.reachable
              ? "Scan your projects and run your first backup."
              : "Set a NAS destination, then scan and back up."}
          </p>
          <Button onClick={() => onNavigate(ov.nas.reachable ? "scan" : "sources")}>
            {ov.nas.reachable ? "Scan & back up" : "Set up destination"}
          </Button>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
            <Tile label="Protected" value={`${ov.projects_protected} projects`} hint={`${ov.snapshot_count} snapshots`} />
            <Tile label="On NAS" value={fmtSize(ov.actual_size)}
              hint={ov.nas.reachable ? `${fmtSize(ov.nas.free_bytes)} free` : "NAS offline"} />
            <Tile label="Saved by dedup" value={fmtSize(ov.saved_bytes)}
              hint={savedPct > 0 ? `${savedPct}% smaller` : "—"} tone="var(--accent-2)" />
            <Tile label="Last backup" value={fmtDate(ov.last_run)}
              hint={ov.last_run_ok ? "✓ all ok" : "⚠ had errors"}
              tone={ov.last_run_ok ? undefined : "var(--warn)"} />
          </div>

          <div className="card" style={{ marginBottom: 18, borderColor: ov.attention.length ? "var(--warn)" : "var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ color: ov.attention.length ? "var(--warn)" : "var(--text)" }}>
                {ov.attention.length ? `⚠ ${ov.attention.length} need attention` : "✓ All projects healthy"}
              </strong>
              <Button variant="ghost" onClick={() => onNavigate("scan")}>Scan & back up</Button>
            </div>
            {ov.attention.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                {ov.attention.map((a) => (
                  <li key={a.project_name} style={{ marginBottom: 4 }}>
                    <strong>{a.project_name}</strong> <span className="sub">— {a.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-dim)", fontSize: 13 }}>
        <span title={ov.nas.path}>
          <span style={{ color: ov.nas.reachable ? "var(--accent-2)" : "var(--danger)" }}>●</span>{" "}
          {ov.nas.reachable ? "NAS connected" : "NAS offline"}
          {ov.nas.path ? ` · ${shortPath(ov.nas.path)}` : ""}
        </span>
        <span>Schedule: {fmtInterval(ov.schedule.interval_minutes)}</span>
      </div>
    </>
  );
}
