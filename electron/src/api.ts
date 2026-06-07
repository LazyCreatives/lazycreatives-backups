import type { Config, JobStatus, Overview, ProjectRow, ProjectSummary, Snapshot, VerifyResult } from "./types";

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
    async scan(sources?: string[], findMissing = false): Promise<ProjectSummary[]> {
      return (await req("POST", "/api/scan", { sources, find_missing: findMissing })).projects;
    },
    async startBackup(opts: {
      sources?: string[]; dest?: string; timestamp?: string; als_paths?: string[];
      label?: string; portable?: boolean; layout?: "project_date" | "date_project";
      find_missing?: boolean;
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
  };
}
export type Api = ReturnType<typeof makeApi>;
