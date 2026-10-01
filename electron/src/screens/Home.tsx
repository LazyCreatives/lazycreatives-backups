import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Overview } from "../types";
import type { BackupProgress } from "../useProgress";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { CountUp } from "../components/CountUp";
import { Info } from "../components/Info";
import { fmtSize, fmtDate, fmtInterval, fmtClock, shortPath } from "../format";
import type { ReactNode, CSSProperties } from "react";

const api = makeApi();

function Tile({ label, value, hint, tone, index = 0, info }: {
  label: string; value: ReactNode; hint?: string; tone?: string; index?: number; info?: string;
}) {
  return (
    <div className="tile tile--enter" style={{ "--i": index } as CSSProperties}>
      <div className="tile__label">{label}{info && <Info text={info} />}</div>
      <div className="tile__value" style={{ color: tone }}>{value}</div>
      {hint && <div className="tile__hint">{hint}</div>}
    </div>
  );
}

export function Home({ backup, onBackupNow, onOpenSettings, onResumeProgress }: {
  backup: BackupProgress;
  onBackupNow: () => void;
  onOpenSettings: () => void;
  onResumeProgress: () => void;
}) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState(false);

  // Refetch whenever a backup finishes so the tiles update.
  useEffect(() => { api.overview().then(setOv).catch(() => setErr(true)); }, [backup.done]);

  // The pool size is computed in the background the first time; poll until it lands.
  useEffect(() => {
    if (ov && !ov.pool_known) {
      const t = setTimeout(() => api.overview().then(setOv).catch(() => {}), 3000);
      return () => clearTimeout(t);
    }
  }, [ov]);

  if (err) return (
    <>
      <PageHeader title="Home" />
      <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>Couldn't reach the backup service.</div>
    </>
  );
  if (!ov) return (<><PageHeader title="Home" subtitle="Loading…" /></>);

  const savedPct = ov.logical_size > 0 ? Math.round((ov.saved_bytes / ov.logical_size) * 100) : 0;
  const empty = ov.snapshot_count === 0;
  const running = backup.active;

  return (
    <>
      <PageHeader
        title="Home"
        subtitle="Your projects, backed up and verified."
        actions={running
          ? <Button onClick={onResumeProgress}>View backup in progress →</Button>
          : <Button onClick={onBackupNow} disabled={!ov.nas.reachable}>Back up now</Button>}
      />

      {running && (
        <button className="card" onClick={onResumeProgress}
          style={{ width: "100%", textAlign: "left", cursor: "pointer", marginBottom: 16, borderColor: "var(--accent)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span><span className="nav__dot" style={{ display: "inline-block", marginRight: 8 }} />
            {backup.preparing ? "Preparing backup…" : backup.current ? `Backing up ${backup.current}…` : "Backing up…"}</span>
          <span className="sub" style={{ margin: 0 }}>View →</span>
        </button>
      )}

      {empty ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <strong>{ov.nas.reachable ? "No backups yet." : "Almost there."}</strong>
          <p className="sub" style={{ margin: "6px 0 14px" }}>
            {ov.nas.reachable ? "Back up your projects to protect them." : "Set a NAS destination, then back up."}
          </p>
          <Button onClick={ov.nas.reachable ? onBackupNow : onOpenSettings}>
            {ov.nas.reachable ? "Back up now" : "Open settings"}
          </Button>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
            <Tile index={0} label="Protected"
              value={<CountUp value={ov.projects_protected} format={(n) => `${Math.round(n)} projects`} />}
              hint={`${ov.snapshot_count} backup${ov.snapshot_count === 1 ? "" : "s"}`}
              info="Projects you've backed up at least once. Each time you back one up, it keeps a dated version." />
            <Tile index={1} label="On your drive"
              value={ov.pool_known ? <CountUp value={ov.actual_size} format={fmtSize} /> : <span className="shimmer">calculating…</span>}
              hint={ov.nas.reachable ? `${fmtSize(ov.nas.free_bytes)} free` : "drive offline"}
              info="How much space your backups take on your own NAS/drive. No cloud, no subscription — it's all yours." />
            <Tile index={2} label="Space saved"
              value={ov.pool_known ? <CountUp value={ov.saved_bytes} format={fmtSize} /> : <span className="shimmer">…</span>}
              hint={ov.pool_known && savedPct > 0 ? `${savedPct}% smaller` : "—"} tone="var(--accent-2)"
              info="We store each file once, even when many backups use it — so your backups take far less space than copying everything every time." />
            <Tile index={3} label="Last backup" value={fmtDate(ov.last_run)}
              hint={ov.last_run_ok ? "✓ all ok" : "⚠ check results"} tone={ov.last_run_ok ? undefined : "var(--warn)"} />
          </div>

          {ov.pool_known && ov.logical_size > 0 && ov.saved_bytes > 0 && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
                <strong style={{ display: "flex", alignItems: "center" }}>Space saved
                  <Info text="Your backups would take this much if every version copied everything. Because we store each file once, they actually take far less." /></strong>
                <span className="sub" style={{ margin: 0, color: "var(--accent-2)" }}>
                  {fmtSize(ov.saved_bytes)} saved · {savedPct}% smaller
                </span>
              </div>
              <div className="dedupbar">
                <div className="dedupbar__actual" style={{ width: `${Math.max(3, Math.round((ov.actual_size / ov.logical_size) * 100))}%` }} />
              </div>
              <div className="sub" style={{ margin: "7px 0 0", fontSize: 11.5, display: "flex", justifyContent: "space-between" }}>
                <span>{fmtSize(ov.actual_size)} actually stored</span>
                <span>{fmtSize(ov.logical_size)} if copied in full</span>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 18, borderColor: ov.attention.length ? "var(--warn)" : "var(--border)" }}>
            <strong style={{ color: ov.attention.length ? "var(--warn)" : "var(--text)" }}>
              {ov.attention.length ? `⚠ ${ov.attention.length} need attention` : "✓ All projects healthy"}
            </strong>
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
          {ov.nas.reachable ? "NAS connected" : "NAS offline"}{ov.nas.path ? ` · ${shortPath(ov.nas.path)}` : ""}
        </span>
        <span>
          Auto-backup: {fmtInterval(ov.schedule.interval_minutes)}
          {ov.schedule.enabled && ov.schedule.next_run ? ` · next ${fmtClock(ov.schedule.next_run)}` : ""}
        </span>
      </div>
    </>
  );
}
