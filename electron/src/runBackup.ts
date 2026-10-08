import { makeApi } from "./api";
import type { JobStatus } from "./types";

// Back up some projects and wait for the run to end, then say plainly whether it
// worked. Used by the one-project buttons (Library "Back up", Home "Back up" and
// "Find missing samples"), so a failure is never silent.

const api = makeApi();

export const DRIVE_GONE = "Your backup drive isn't connected. Plug it in and try again.";

export type RunFailure = { project_name: string; path?: string; reason: string };
export type RunResult =
  | { ok: true; result: NonNullable<JobStatus["result"]> }
  | { ok: false; reason: string; failed: RunFailure[] };

type Opts = Parameters<ReturnType<typeof makeApi>["startBackup"]>[0];

// Turn an error from the engine into words a person can act on.
export function plainReason(raw?: string | null): string {
  const r = (raw || "").trim();
  if (!r) return "Something went wrong while backing it up.";
  // Checked first: an unplugged drive must never read as a permissions problem.
  if (/backup drive isn't connected/i.test(r)) return DRIVE_GONE;
  if (/no space left|disk full|ENOSPC/i.test(r)) return "The backup drive is full.";
  if (/permission denied|EACCES|EPERM|not permitted/i.test(r)) return "Backups wasn't allowed to read or write one of its files.";
  if (/no such file|not found|ENOENT|FileNotFound/i.test(r)) return "A file was moved or deleted while it was being backed up.";
  if (/failed to fetch|networkerror|ECONNREFUSED/i.test(r)) return "Backups lost touch with its engine. Restart the app and try again.";
  if (/not reachable|unreachable|backup (folder|drive)|no destination/i.test(r)) return DRIVE_GONE;
  if (/already running|busy|409/.test(r)) return "Another backup is still running. Try again when it's done.";
  return `Something went wrong: ${r.length > 140 ? r.slice(0, 140) + "…" : r}`;
}

export async function backupAndWait(opts: Opts, every = 1200): Promise<RunResult> {
  try {
    const { job_id } = await api.startBackup(opts);
    for (;;) {
      const st = await api.jobStatus(job_id);
      if (st.state === "error") return { ok: false, reason: plainReason(st.error), failed: [] };
      if (st.state === "done") return judge(st.result ?? {}, opts.als_paths?.length ?? 0);
      await new Promise((r) => setTimeout(r, every));
    }
  } catch (e: any) {
    return { ok: false, reason: plainReason(e?.message), failed: [] };
  }
}

// A finished run can still have projects that failed, or (for a project file that
// was moved) nothing at all to back up.
export function judge(result: NonNullable<JobStatus["result"]>, asked: number): RunResult {
  const failed = (result.errors ?? []).map((e) => ({ project_name: e.project_name, path: e.path, reason: plainReason(e.error) }));
  if ((result.error_count ?? 0) > 0) {
    return { ok: false, failed, reason: failed[0]?.reason ?? "Something went wrong while backing it up." };
  }
  const reached = (result.ok_count ?? 0) + (result.skipped_count ?? 0);
  if (asked > 0 && result.ok_count !== undefined && reached === 0) {
    return { ok: false, failed, reason: "Couldn't find the project file. It may have been moved or renamed; scan again to find it." };
  }
  return { ok: true, result };
}
