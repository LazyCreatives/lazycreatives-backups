import type { CloudFolder, Config, SuggestedFolder, ProjectExports, Entitlement, JobStatus, LibraryItem, Overview, ProjectRow, ProjectSummary, Snapshot, SnapshotDiff, SnapshotFilesResult, TidyBatch, TidyDone, TidyOptions, TidyPlan, UnmatchedSong, VerifyResult } from "./types";

function base() {
  const port = (window as any).ablebackup?.port ?? "8753";
  return `http://127.0.0.1:${port}`;
}
function token() {
  return (window as any).ablebackup?.token ?? "";
}

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(base() + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Auth-Token": token() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

export function makeApi() {
  return {
    async getSettings(): Promise<Config> { return req("GET", "/api/settings"); },
    async saveSettings(c: Config): Promise<Config> { return req("PUT", "/api/settings", c); },
    // First run: the usual project folders on this computer, most projects first.
    async suggestedFolders(): Promise<SuggestedFolder[]> { return req("GET", "/api/setup/suggested-folders"); },
    async scan(sources?: string[], findMissing = false): Promise<ProjectSummary[]> {
      return (await req("POST", "/api/scan", { sources, find_missing: findMissing })).projects;
    },
    // Scan by scope (sources|home|volumes); persists to the library.
    async scanMac(scope: string, findMissing = false): Promise<{ projects: ProjectSummary[]; scope: string; full_disk_access: boolean; skipped_dirs: number; skipped_examples: string[] }> {
      return req("POST", "/api/scan", { scope, find_missing: findMissing });
    },
    async library(): Promise<{ projects: LibraryItem[]; owners: string[]; count: number; unmatched_songs?: number }> {
      return req("GET", "/api/library");
    },
    // Correct projects' genre; null goes back to what the app guessed.
    async setGenre(projectIds: string[], genre: string | null): Promise<{ changed: number; relearned?: number }> {
      return req("POST", "/api/project/genre", { project_ids: projectIds, genre });
    },
    // Live, complete list of one project's missing samples — re-scanned on demand so
    // it reflects the current state of disk (the trust view). With find=true each
    // sample is also marked `recoverable` (auto-findable in the library).
    async projectMissing(path: string, find = false): Promise<{
      name: string; path: string; present_count: number; missing_count: number;
      recoverable_count: number; probed: boolean;
      missing: { name: string; expected_path: string; recoverable: boolean }[];
    }> {
      return req("GET", `/api/project/missing?path=${encodeURIComponent(path)}${find ? "&find=1" : ""}`);
    },
    async startBackup(opts: {
      sources?: string[]; dest?: string; timestamp?: string; als_paths?: string[];
      label?: string; portable?: boolean; layout?: "project_date" | "date_project";
      find_missing?: boolean; libraries?: string[];  // one-off folders to also search this run
      relink_map?: Record<string, string>;  // exact per-file remaps {expected_path -> chosen file}
    }): Promise<{ job_id: string }> {
      return req("POST", "/api/backup", opts);
    },
    async jobStatus(id: string): Promise<JobStatus> { return req("GET", `/api/jobs/${id}`); },
    async cancelJob(id: string): Promise<{ cancelling: boolean }> { return req("POST", `/api/jobs/${id}/cancel`); },
    async overview(): Promise<Overview> { return req("GET", "/api/overview"); },
    async history(limit = 50): Promise<Snapshot[]> {
      return (await req("GET", `/api/history?limit=${limit}`)).snapshots;
    },
    async projects(): Promise<ProjectRow[]> {
      return (await req("GET", "/api/projects")).projects;
    },
    async projectDetail(name: string): Promise<{ project_name: string; snapshots: Snapshot[] }> {
      return req("GET", `/api/projects/${encodeURIComponent(name)}`);
    },
    async verify(id: number): Promise<VerifyResult> { return req("GET", `/api/verify/${id}`); },
    async restore(snapshotId: number, target: string): Promise<{ job_id: string }> {
      return req("POST", "/api/restore", { snapshot_id: snapshotId, target });
    },
    async snapshotFiles(id: number): Promise<SnapshotFilesResult> {
      return req("GET", `/api/snapshot/${id}/files`);
    },
    async snapshotDiff(id: number): Promise<SnapshotDiff> {
      return req("GET", `/api/snapshot/${id}/diff`);
    },
    async share(snapshotId: number, target: string): Promise<{ job_id: string }> {
      return req("POST", "/api/share", { snapshot_id: snapshotId, target });
    },
    async rclone(): Promise<{ available: boolean; remotes: string[] }> { return req("GET", "/api/rclone"); },
    // Dropbox / Google Drive / iCloud / OneDrive folders on this computer (path null = not found).
    async cloudFolders(): Promise<{ folders: CloudFolder[]; subdir: string }> {
      return req("GET", "/api/cloud/folders");
    },
    async cloudProviders(): Promise<{ key: string; label: string }[]> {
      return (await req("GET", "/api/cloud/providers")).providers;
    },
    async cloudConnect(provider: string, name?: string): Promise<{ connect_id: string; auth_url: string | null; remote: string; provider: string }> {
      return req("POST", "/api/cloud/connect", { provider, name });
    },
    async cloudConnectStatus(id: string): Promise<{ status: "pending" | "connected" | "failed"; remote: string; auth_url: string | null; error: string | null }> {
      return req("GET", `/api/cloud/connect/${id}`);
    },
    async cloudDisconnect(name: string): Promise<{ ok: boolean; remotes: string[] }> {
      return req("POST", "/api/cloud/disconnect", { name });
    },
    // Song exports linked to a project, with their SoundCloud uploads (from Uploader).
    async projectExports(projectId: string): Promise<ProjectExports> {
      return req("GET", `/api/exports?project_id=${encodeURIComponent(projectId)}`);
    },
    async exportFolders(): Promise<{ folders: string[]; found_folders?: string[]; ignored?: string[]; uploader_folders: string[] }> {
      return req("GET", "/api/exports/folders");
    },
    async setExportFolders(folders: string[], ignored?: string[]): Promise<{ folders: string[]; linked: number | null; running: boolean }> {
      return req("PUT", "/api/exports/folders", ignored ? { folders, ignored } : { folders });
    },
    async refreshExports(): Promise<{ linked: number | null; running: boolean }> { return req("POST", "/api/exports/refresh"); },
    async exportsStatus(): Promise<{ running: boolean; folders_done: number; folders_total: number; current: string; linked: number | null; timed_out: boolean }> {
      return req("GET", "/api/exports/status");
    },
    async linkExport(path: string, projectId: string): Promise<{ ok: boolean }> {
      return req("POST", "/api/exports/link", { path, project_id: projectId });
    },
    async unlinkExport(path: string, projectId: string): Promise<{ ok: boolean }> {
      return req("POST", "/api/exports/unlink", { path, project_id: projectId });
    },
    // Songs in exports folders no project matched (or the ones marked "not a song").
    async unmatchedSongs(ignored = false): Promise<{ songs: UnmatchedSong[]; count: number }> {
      return req("GET", `/api/exports/unmatched${ignored ? "?ignored=true" : ""}`);
    },
    async ignoreSong(path: string, ignored = true): Promise<{ ok: boolean }> {
      return req("POST", "/api/exports/ignore", { path, ignored });
    },
    // markers (locators, cues) saved in a project, in seconds from the start
    async projectMarkers(path: string): Promise<{ markers: { t: number; name: string }[] }> {
      return req("GET", `/api/project/markers?path=${encodeURIComponent(path)}`);
    },
    // the outline of a song, for drawing its waveform (null: decode it here)
    async exportPeaks(path: string): Promise<{ peaks: number[] | null }> {
      return req("GET", `/api/exports/peaks?path=${encodeURIComponent(path)}`);
    },
    // <audio> can't send headers, so the token rides in the query (sidecar only
    // serves files already linked as exports).
    exportAudioUrl(path: string): string {
      return `${base()}/api/exports/audio?path=${encodeURIComponent(path)}&t=${encodeURIComponent(token())}`;
    },
    // Tidy names: preview changes nothing; apply renames; undo puts every name back.
    async tidyPreview(o: TidyOptions): Promise<TidyPlan> { return req("POST", "/api/tidy/preview", o); },
    async tidyApply(o: TidyOptions): Promise<TidyDone> { return req("POST", "/api/tidy/apply", o); },
    async tidyLast(projectId: string): Promise<{ batch: TidyBatch | null }> {
      return req("GET", `/api/tidy/last?project_id=${encodeURIComponent(projectId)}`);
    },
    async tidyUndo(batchId: string): Promise<{ restored: number; id_map: Record<string, string> }> {
      return req("POST", "/api/tidy/undo", { batch_id: batchId });
    },
    async entitlement(): Promise<Entitlement> { return req("GET", "/api/entitlement"); },
    async activateLicense(key: string): Promise<Entitlement> { return req("POST", "/api/entitlement/activate", { key }); },
    async deactivateLicense(): Promise<Entitlement> { return req("POST", "/api/entitlement/deactivate"); },
  };
}
export type Api = ReturnType<typeof makeApi>;
