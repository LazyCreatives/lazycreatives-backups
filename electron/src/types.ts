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
  mtime: number;
}
export interface Config {
  sources: string[];
  dest: string;
  interval_minutes: number;
  libraries: string[];
  mirrors?: string[];  // offsite/cloud destinations (Studio)
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
export interface SnapshotFile {
  logical_path: string;
  size: number;
  inside_project: boolean;
  relinked: boolean;
  source_path: string;
}
export interface SnapshotFilesResult {
  files: SnapshotFile[];
  manifest_present: boolean;
  portable?: boolean | null;
  missing: string[];
  total_size?: number;
}
export interface SnapshotDiff {
  available: boolean;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
  prev_timestamp: string | null;
  is_first: boolean;
}
export interface ProjectRow {
  project_name: string;
  snapshot_count: number;
  last_timestamp: string;
  total_size: number;
  daw?: string;
  genre?: string | null;
  genre_emoji?: string;
  bpm?: number | null;
  genre_confidence?: number;
  genre_pending?: boolean;
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
  pool_known: boolean;
  last_run: string | null;
  last_run_ok: boolean;
  attention: AttentionItem[];
  nas: NasStatus;
  schedule: { enabled: boolean; interval_minutes: number; next_run?: string | null };
}
export type Tier = "free" | "pro" | "studio";
export interface Entitlement {
  tier: Tier;
  features: {
    scheduled: boolean;
    restore: boolean;
    multi_daw: boolean;
    auto_relink: boolean;
    deep_verify: boolean;
    cloud_backup: boolean;
  };
}
export interface JobStatus {
  state: "running" | "done" | "error";
  result?: { timestamp?: string; ok_count?: number; error_count?: number; path?: string };
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
  | { type: "backup_done"; ok_count: number; error_count: number; skipped_count: number; mirror_failed?: number; cancelled?: boolean };

export interface BackupOptions {
  als_paths?: string[];
  label?: string;
  portable?: boolean;
  layout?: "project_date" | "date_project";
}
