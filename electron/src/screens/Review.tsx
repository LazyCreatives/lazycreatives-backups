import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Config } from "../types";
import type { PendingBackup } from "../App";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { Info } from "../components/Info";
import { fmtSize } from "../format";
import { Cover } from "../components/Cover";
import { useLook } from "../look";
import { EmptyState, SlothSpot } from "../components/SlothSpot";
import { useGenres } from "../useGenres";

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
  const [look] = useLook();
  const genreOf = useGenres();

  useEffect(() => { api.getSettings().then(setCfg).catch(() => {}); }, []);

  if (!pending) {
    return (
      <>
        <PageHeader title="Review backup" />
        <EmptyState pose="empty-crate" title="Nothing picked yet">Go back and tick the projects to back up.</EmptyState>
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

  const names = pending.names ?? [];
  const covers = names.slice(0, look === "sleeve" ? (names.length > 8 ? 7 : 8) : 5);
  const more = pending.count - covers.length;

  return (
    <>
      <PageHeader title="Check and start" subtitle="Here's what goes into this backup and where it's kept." />

      {!dest && (
        <div className="notice notice--warn notice--sloth">
          <SlothSpot pose="hugging-drive" size={56} />
          <span>No backup drive is set yet. Pick one in Settings first.</span>
        </div>
      )}

      <div className={`receipt receipt--${look}`}>
        <div className="receipt__covers" aria-hidden>
          {covers.map((n) => <Cover key={n} name={n} genre={genreOf(n)} label={false} />)}
          {more > 0 && <span className="receipt__more mono">+{more}</span>}
        </div>
        <div className="receipt__facts">
          <div><span className="receipt__big">{pending.count}</span><span className="faint">project{pending.count === 1 ? "" : "s"}</span></div>
          <div><span className="receipt__big">{fmtSize(pending.size)}</span><span className="faint">to copy at most</span></div>
          <div className="receipt__dest">
            <span className="faint">Kept in</span>
            <span className="mono col-trunc" title={dest}>{dest ? `${dest}/AbletonBackups` : "Not set"}</span>
          </div>
        </div>
      </div>

      <div className="set-rows">
        <div className="set-row">
          <div className="set-row__label">
            <h2>Opening on another computer
              <Info text="Opens anywhere rewrites the project so its gathered samples load on any machine. Copy as-is keeps the original layout, but samples from other folders may show as missing elsewhere." /></h2>
            <p>How the copy is made.</p>
          </div>
          <div className="set-row__body">
            <div className="seg" role="group">
              <button className={`seg__opt${portable ? " seg__opt--on" : ""}`} onClick={() => setPortable(true)}>Opens anywhere</button>
              <button className={`seg__opt${!portable ? " seg__opt--on" : ""}`} onClick={() => setPortable(false)}>Copy as-is</button>
            </div>
            <span className="faint" style={{ fontSize: 12 }}>
              {portable
                ? "Recommended. The backup opens with all its samples on any computer."
                : "Copies everything exactly as it is now. Opened elsewhere, samples from other folders may show as missing."}
            </span>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row__label"><h2>Folders</h2><p>How backups are filed on the drive.</p></div>
          <div className="set-row__body">
            <select value={layout} onChange={(e) => setLayout(e.target.value as "project_date" | "date_project")} style={{ alignSelf: "flex-start" }}>
              <option value="project_date">By project, then date (recommended)</option>
              <option value="date_project">By date, then project</option>
            </select>
            <span className="faint mono" style={{ fontSize: 12 }}>
              {layout === "project_date" ? "projects/<name>/<date>/" : "by-date/<date>/<name>/"}
            </span>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row__label"><h2>Name</h2><p>Optional, so you can find this one later.</p></div>
          <div className="set-row__body">
            <input type="text" className="input" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. before mixdown" style={{ maxWidth: 360 }} />
          </div>
        </div>
      </div>

      {pending.findMissing && (
        <p className="faint" style={{ fontSize: 12, margin: "4px 0 14px" }}>
          Missing samples will be looked for in your sample library and included.
        </p>
      )}

      {err && <div className="notice notice--danger">{err}</div>}

      <div className="flow-actions">
        <Button variant="ghost" onClick={onCancel}>Back</Button>
        <Button onClick={start} disabled={!dest || starting || pending.count === 0}>
          {starting ? "Starting…" : `Back up ${pending.count} project${pending.count === 1 ? "" : "s"}`}
        </Button>
      </div>
    </>
  );
}
