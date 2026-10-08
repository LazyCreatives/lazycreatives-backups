import { useEffect, useState } from "react";
import type { BackupProgress } from "../useProgress";
import { ProgressBar } from "../components/ProgressBar";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { VerifiedSeal } from "../components/VerifiedSeal";
import { Rolling } from "../components/Rolling";
import { makeApi } from "../api";
import type { Snapshot } from "../types";
import { fmtDate } from "../format";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { coverColor, useLook } from "../look";
import type { BackupItem } from "../useProgress";
import { EmptyState, SlothSpot } from "../components/SlothSpot";
import { useGenres } from "../useGenres";
import { plainReason } from "../runBackup";

const STATE_TEXT: Record<BackupItem["state"], string> = {
  working: "Backing up…", done: "Safe", skipped: "Already safe", error: "Failed",
};

const api = makeApi();

// onRetry: a new run started from "Try these again" (its job id), so Cancel follows it.
export function Backup({ progress: p, jobId, onRetry }: { progress: BackupProgress; jobId: string | null; onRetry?: (jobId: string) => void }) {
  const [last, setLast] = useState<Snapshot | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);
  const idle = !p.active && !p.done && p.total === 0;

  useEffect(() => {
    if (idle) api.history(1).then((h) => setLast(h[0] ?? null)).catch(() => {});
  }, [idle]);

  // Reset the cancelling flag once a run is no longer active.
  useEffect(() => { if (!p.active) setCancelling(false); }, [p.active]);

  // Back up just the projects that failed, as a new run on this same screen.
  const failedItems = p.items.filter((it) => it.state === "error");
  async function retryFailed() {
    setRetrying(true); setRetryErr(null);
    try {
      const names = new Set(failedItems.map((it) => it.name));
      const lib = await api.library();
      const paths = lib.projects.filter((i) => names.has(i.name)).map((i) => i.path);
      if (!paths.length) { setRetryErr("Couldn't find those projects any more. Scan again in the Library to find them."); return; }
      const { job_id } = await api.startBackup({ als_paths: paths, portable: true, layout: "project_date", find_missing: true });
      onRetry?.(job_id);
    } catch (e: any) { setRetryErr(plainReason(e?.message)); }
    finally { setRetrying(false); }
  }

  async function cancel() {
    if (!jobId) return;
    setCancelling(true);
    try { await api.cancelJob(jobId); } catch { setCancelling(false); }
  }

  const subtitle = p.preparing ? "Preparing…"
    : p.active && p.current ? `Backing up ${p.current}…`
    : p.active ? "Working…"
    : p.cancelled ? "Stopped before the end."
    : p.done && p.errors > 0 ? "The ones that couldn't be backed up are at the top, with the reason."
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
              <p className="sub" style={{ margin: "10px 0 0" }}>Start a new backup with Back up now on Home, or Back up on a project in the Library.</p>
            </>
          ) : (
            <EmptyState pose="napping" title="No backups yet" say="Wake me when there’s something to keep.">Press Back up now on Home and the first one starts.</EmptyState>
          )}
        </div>
      ) : (
        <>
          {p.done && !p.cancelled && p.errors > 0 && (
            <div className="card run-done run-done--warn" role="alert">
              <Icon name="alert" size={26} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="run-done__title">
                  {p.completed > 0 ? `${p.completed} backed up, ${p.errors} couldn't be` : `${p.errors} project${p.errors === 1 ? "" : "s"} couldn't be backed up`}
                </div>
                <div className="faint">
                  {p.skipped > 0 ? `${p.skipped} already safe with no changes. ` : ""}
                  {p.completed + p.skipped > 0 ? "Those are safe; the ones below need another go." : "Nothing was changed in your backup."}
                </div>
                {p.mirrorFailed > 0 && (
                  <div style={{ margin: "6px 0 0", fontSize: 12, color: "var(--warn)" }}>
                    Copying to your second backup place failed for {p.mirrorFailed} {p.mirrorFailed === 1 ? "project" : "projects"}. Check that place in Settings.
                  </div>
                )}
                <ul className="run-fails">
                  {failedItems.map((it, i) => (
                    <li key={`${it.name}-${i}`}><b>{it.name}</b><span>{plainReason(it.detail)}</span></li>
                  ))}
                </ul>
                {retryErr && <div className="run-fails__err">{retryErr}</div>}
              </div>
              {onRetry && failedItems.length > 0 && (
                <Button onClick={retryFailed} disabled={retrying}>{retrying ? "Starting…" : failedItems.length === 1 ? "Try it again" : "Try these again"}</Button>
              )}
            </div>
          )}
          {p.done && !p.cancelled && p.errors === 0 && (
            <div className="card celebrate run-done">
              <VerifiedSeal size={54} />
              <div>
                <div className="run-done__title">Backed up and checked</div>
                <div className="faint">
                  {p.completed > 0
                    ? <><Rolling value={p.completed} /> project{p.completed === 1 ? "" : "s"} backed up{p.skipped > 0 ? `, ${p.skipped} already safe with no changes` : ""}</>
                    : p.skipped > 0 ? `All ${p.skipped} already safe, nothing had changed` : "Nothing was backed up"}
                </div>
                {p.mirrorFailed > 0 && (
                  <div style={{ margin: "6px 0 0", fontSize: 12, color: "var(--warn)" }}>
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
                <span className={look === "sleeve" ? "run__name" : "run__title"}>{p.preparing ? "Finding your projects…" : nowName}</span>
                <span className="faint mono">{p.preparing ? "" : `${doneCount} of ${p.total}`}{p.skipped > 0 ? ` · ${p.skipped} unchanged` : ""}{p.errors > 0 ? ` · ${p.errors} failed` : ""}</span>
              </div>
              <SlothSpot pose="hugging-drive" size={look === "sleeve" ? 132 : 72} />
            </div>
            <ProgressBar value={p.preparing ? 1 : doneCount} max={p.preparing ? 1 : p.total} active={p.active} />
          </div>}

          {p.items.length > 0 && look === "crate" && (
            <div className="table table--crate">
              {(p.done ? failedFirst([...p.items].reverse()) : [...p.items].reverse()).map((it, i) => (
                <div key={`${it.name}-${i}`} className="row cols run-cols">
                  <span className="stripe" style={{ background: coverColor(genreOf(it.name), it.name) }} />
                  <Cover name={it.name} genre={genreOf(it.name)} size={32} label={false} />
                  <span className="lib-name">{it.name}</span>
                  <span className={`run-state run-state--${it.state}`}><span className="dot" />{STATE_TEXT[it.state]}</span>
                  <span className={`col-trunc${it.state === "error" ? " run-why" : " faint"}`} title={it.detail}>{it.state === "error" ? plainReason(it.detail) : it.detail ?? ""}</span>
                </div>
              ))}
            </div>
          )}
          {p.items.length > 0 && look === "sleeve" && (
            <div className="run-wall">
              {(p.done ? failedFirst(p.items) : p.items).map((it, i) => (
                <div key={`${it.name}-${i}`} className={`run-tile run-tile--${it.state}`} title={`${it.name}: ${STATE_TEXT[it.state]}${it.detail ? `, ${it.detail}` : ""}`}>
                  <Cover name={it.name} genre={genreOf(it.name)} label={false} />
                  <span className="run-tile__mark" aria-hidden>
                    {it.state === "done" ? <Icon name="check" size={14} /> : it.state === "error" ? <Icon name="alert" size={14} /> : it.state === "skipped" ? <Icon name="check" size={14} /> : null}
                  </span>
                  <span className="run-tile__name">{it.name}</span>
                  {it.state === "error" && <span className="run-tile__why">{plainReason(it.detail)}</span>}
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

// When a run is over, the projects that failed go to the top of the list.
function failedFirst(items: BackupItem[]): BackupItem[] {
  return [...items.filter((it) => it.state === "error"), ...items.filter((it) => it.state !== "error")];
}
