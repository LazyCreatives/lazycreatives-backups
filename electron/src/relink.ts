import { makeApi } from "./api";

const api = makeApi();

// Re-back up one project with sample-hunting on, optionally with one-off library
// folders and/or exact per-file remaps the user pointed at. Resolves when the backup
// finishes; throws on error. Shared by the Missing-samples panel and the backups view.
export async function runRelinkBackup(path: string, opts: {
  libraries?: string[];
  relink_map?: Record<string, string>;
} = {}): Promise<void> {
  const { job_id } = await api.startBackup({
    als_paths: [path], portable: true, layout: "project_date", find_missing: true, ...opts,
  });
  for (;;) {
    const st = await api.jobStatus(job_id);
    if (st.state === "done") return;
    if (st.state === "error") throw new Error(st.error || "Backup failed.");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// Pick a single audio file and remap one missing sample to it, then re-back up.
export async function pointSampleToFile(path: string, expectedPath: string): Promise<boolean> {
  const file = await (window as any).ablebackup?.pickFile?.();
  if (!file) return false;
  await runRelinkBackup(path, { relink_map: { [expectedPath]: file } });
  return true;
}
