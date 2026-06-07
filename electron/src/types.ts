export interface ProjectSummary {
  name: string;
  daw: string;
  project_dir: string;
  als_path: string;
  present_count: number;
  relinked_count: number;
  missing_count: number;
  missing: string[];
  total_size: number;
}
export interface Config {
  sources: string[];
  dest: string;
  interval_minutes: number;
  libraries: string[];
}
export interface Snapshot {
  id: number;
  project_name: string;
  timestamp: string;
  total_size: number;
  file_count: number;
  status: string;
  error: string | null;
  missing?: string[];
  dir?: string;
  label?: string | null;
  verified?: number;
  relinked_count?: number;
  daw?: string;
}
export interface VerifyResult {
  ok: boolean;
  checked: number;
  present: number;
  missing_files: string[];
  bad_files: string[];
  portable_ok: boolean | null;
  portable_missing: string[];
  relinked: { logical_path: string; source_path: string }[];
  error: string | null;
}
export interface ProjectRow {
  project_name: string;
  snapshot_count: number;
  last_timestamp: string;
  total_size: number;
}
export interface AttentionItem {
  project_name: string;
  kind: "error" | "missing";
  reason: string;
}
export interface NasStatus {
  reachable: boolean;
  path: string;
  free_bytes: number;
  total_bytes: number;
}
export interface Overview {
  projects_protected: number;
  snapshot_count: number;
  logical_size: number;
  actual_size: number;
  saved_bytes: number;
  last_run: string | null;
  last_run_ok: boolean;
  attention: AttentionItem[];
  nas: NasStatus;
  schedule: { enabled: boolean; interval_minutes: number };
}
export interface JobStatus {
  state: "running" | "done" | "error";
  result?: { timestamp: string; ok_count: number; error_count: number };
  error?: string;
}
export type ProgressEvent =
  | { type: "scan_start"; total: number }
  | { type: "scan_progress"; done: number; total: number; name: string }
  | { type: "scan_done"; count: number }
  | { type: "backup_preparing" }
  | { type: "backup_start"; project_count: number; timestamp: string }
  | { type: "project_start"; index: number; project_name: string; total: number }
  | { type: "project_done"; index: number; project_name: string; file_count: number; missing_count: number }
  | { type: "project_skipped"; index: number; project_name: string }
  | { type: "project_error"; index: number; project_name: string; error: string }
  | { type: "backup_done"; ok_count: number; error_count: number; skipped_count: number; cancelled?: boolean };

export interface BackupOptions {
  als_paths?: string[];
  label?: string;
  portable?: boolean;
  layout?: "project_date" | "date_project";
}
