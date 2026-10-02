import { useEffect, useState } from "react";
import { SlothMascot } from "../components/SlothMascot";
import type { BackupProgress } from "../useProgress";
import { ProgressBar } from "../components/ProgressBar";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { VerifiedSeal } from "../components/VerifiedSeal";
import { CountUp } from "../components/CountUp";
import { makeApi } from "../api";
import type { Snapshot } from "../types";
import { fmtDate } from "../format";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { coverColor, useLook } from "../look";
import type { BackupItem } from "../useProgress";
import { useGenres } from "../useGenres";

const STATE_TEXT: Record<BackupItem["state"], string> = {
  working: "Backing up…", done: "Safe", skipped: "Already safe", error: "Failed",
};

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
    : p.cancelled ? "Stopped before the end."
    : p.done ? "Every project below is in your backup." : "No backup running.";
  const doneCount = p.completed + p.skipped + p.errors;
  const [look] = useLook();
  const genreOf = useGenres();
  const nowName = p.current ?? p.items[p.items.length - 1]?.name ?? "Your projects";

  return (
    <>
      <PageHeader
        title={p.done ? (p.cancelled ? "Backup stopped" : "Backup finished") : "Backing up"}
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
            <div className="empty"><div className="empty__icon"><SlothMascot label="Napping — no backups yet" /></div>No backups yet. Start one from Scan &amp; Back up.</div>
          )}
        </div>
      ) : (
        <>
          {p.done && !p.cancelled && (
            <div className="card celebrate run-done">
              <VerifiedSeal size={54} />
              <div>
                <div className="run-done__title">Backed up and checked</div>
                <div className="faint">
                  {p.completed > 0
                    ? <><CountUp value={p.completed} format={(n) => `${Math.round(n)}`} /> project{p.completed === 1 ? "" : "s"} backed up{p.skipped > 0 ? `, ${p.skipped} already safe with no changes` : ""}</>
                    : p.skipped > 0 ? `All ${p.skipped} already safe, nothing had changed` : "Nothing was backed up"}
                  {p.errors > 0 ? ` · ${p.errors} couldn't be backed up` : ""}
                </div>
                {p.mirrorFailed > 0 && (
                  <div style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--warn)" }}>
                    Copying to your second backup place failed for {p.mirrorFailed} {p.mirrorFailed === 1 ? "project" : "projects"}. The main backup is safe; check that place in Settings.
                  </div>
                )}
              </div>
            </div>
          )}

          {!p.done && <div className={`run run--${look}`}>
            <div className="run__now">
              {look === "sleeve" && <Cover name={nowName} genre={genreOf(nowName)} size={132} className="run__cover" />}
              {look === "crate" && <span className="stripe" style={{ background: coverColor(genreOf(nowName), nowName) }} />}
              {look === "crate" && <Cover name={nowName} genre={genreOf(nowName)} size={56} label={false} />}
              <div className="run__text">
                <span className="eyebrow">{p.preparing ? "Getting ready" : "Now backing up"}</span>
                <span className={look === "sleeve" ? "run__name display" : "run__title"}>{p.preparing ? "Finding your projects…" : nowName}</span>
                <span className="faint mono">{p.preparing ? "" : `${doneCount} of ${p.total}`}{p.skipped > 0 ? ` · ${p.skipped} unchanged` : ""}{p.errors > 0 ? ` · ${p.errors} failed` : ""}</span>
              </div>
            </div>
            <ProgressBar value={p.preparing ? 1 : doneCount} max={p.preparing ? 1 : p.total} active={p.active} />
          </div>}

          {p.items.length > 0 && look === "crate" && (
            <div className="table table--crate">
              {[...p.items].reverse().map((it, i) => (
                <div key={`${it.name}-${i}`} className="row cols run-cols">
                  <span className="stripe" style={{ background: coverColor(genreOf(it.name), it.name) }} />
                  <Cover name={it.name} genre={genreOf(it.name)} size={32} label={false} />
                  <span className="lib-name">{it.name}</span>
                  <span className={`run-state run-state--${it.state}`}><span className="dot" />{STATE_TEXT[it.state]}</span>
                  <span className="faint col-trunc">{it.detail ?? ""}</span>
                </div>
              ))}
            </div>
          )}
          {p.items.length > 0 && look === "sleeve" && (
            <div className="run-wall">
              {p.items.map((it, i) => (
                <div key={`${it.name}-${i}`} className={`run-tile run-tile--${it.state}`} title={`${it.name}: ${STATE_TEXT[it.state]}${it.detail ? `, ${it.detail}` : ""}`}>
                  <Cover name={it.name} genre={genreOf(it.name)} label={false} />
                  <span className="run-tile__mark" aria-hidden>
                    {it.state === "done" ? <Icon name="check" size={14} /> : it.state === "error" ? <Icon name="alert" size={14} /> : it.state === "skipped" ? <Icon name="check" size={14} /> : null}
                  </span>
                  <span className="run-tile__name">{it.name}</span>
                </div>
              ))}
            </div>
          )}

          <details className="run-log">
            <summary>Show the full log</summary>
            <div className="mono">
              {p.log.map((line, i) => <div key={i} className="logline">{line}</div>)}
            </div>
          </details>
        </>
      )}
    </>
  );
}
