import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Config } from "../types";
import type { PendingBackup } from "../App";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { fmtSize } from "../format";

const api = makeApi();

export function Review({ pending, onStarted, onCancel }: {
  pending: PendingBackup | null;
  onStarted: (jobId: string) => void;
  onCancel: () => void;
}) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [label, setLabel] = useState("");
  const [portable, setPortable] = useState(true);
  const [layout, setLayout] = useState<"project_date" | "date_project">("project_date");
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => { api.getSettings().then(setCfg).catch(() => {}); }, []);

  if (!pending) {
    return (
      <>
        <PageHeader title="Review backup" />
        <div className="empty">Nothing selected — go to Scan &amp; Back up first.</div>
        <Button variant="ghost" onClick={onCancel}>Back</Button>
      </>
    );
  }

  const dest = cfg?.dest || "";

  async function start() {
    setStarting(true); setErr(null);
    try {
      const { job_id } = await api.startBackup({
        als_paths: pending!.als_paths,
        label: label.trim() || undefined,
        portable, layout,
        find_missing: pending!.findMissing,
      });
      onStarted(job_id);
    } catch (e: any) { setErr(e.message); setStarting(false); }
  }

  return (
    <>
      <PageHeader title="Review backup" subtitle="Confirm what's included and how it'll be stored." />

      {!dest && (
        <div className="card" style={{ borderColor: "var(--warn)", color: "var(--warn)", marginBottom: 16 }}>
          No NAS destination set — pick one in Sources &amp; NAS first.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div className="tile"><div className="tile__label">Projects</div><div className="tile__value">{pending.count}</div></div>
        <div className="tile"><div className="tile__label">Total size</div><div className="tile__value">{fmtSize(pending.size)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Destination</h2>
        <div className="mono" style={{ color: dest ? "var(--text)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {dest ? `${dest}/AbletonBackups` : "Not set"}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Portability</h2>
        <div className="seg" role="group">
          <button className={`seg__opt${portable ? " seg__opt--on" : ""}`} onClick={() => setPortable(true)}>Portable</button>
          <button className={`seg__opt${!portable ? " seg__opt--on" : ""}`} onClick={() => setPortable(false)}>Archive</button>
        </div>
        <p className="sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
          {portable
            ? "Rewrites the project so it opens on any machine — external samples collected in and re-linked (Ableton)."
            : "Copies everything as-is; opened elsewhere, external samples may show as missing."}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Organization</h2>
        <select value={layout} onChange={(e) => setLayout(e.target.value as "project_date" | "date_project")}>
          <option value="project_date">By project, then date (recommended)</option>
          <option value="date_project">By date, then project</option>
        </select>
        <p className="sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
          {layout === "project_date"
            ? "projects/<name>/<date>/ — best for “the latest version of this song”."
            : "by-date/<date>/<name>/ — best for “what did I have on this day”."}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Name (optional)</h2>
        <input type="text" className="input" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. pre-mixdown" style={{ width: "100%" }} />
      </div>

      {pending.findMissing && (
        <p className="sub" style={{ fontSize: 12.5, margin: "0 0 14px" }}>
          ↻ Missing samples will be searched for in your library and included.
        </p>
      )}

      {err && <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", marginBottom: 14 }}>{err}</div>}

      <div style={{ display: "flex", gap: 10 }}>
        <Button onClick={start} disabled={!dest || starting || pending.count === 0}>
          {starting ? "Starting…" : `Start backup · ${pending.count} project${pending.count === 1 ? "" : "s"}`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </>
  );
}
