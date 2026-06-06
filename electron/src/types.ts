export interface ProjectSummary {
  name: string;
  project_dir: string;
  als_path: string;
  present_count: number;
  missing_count: number;
  missing: string[];
  total_size: number;
}
export interface Config {
  sources: string[];
  dest: string;
  interval_minutes: number;
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
}
export interface ProjectRow {
  project_name: string;
  snapshot_count: number;
  last_timestamp: string;
  total_size: number;
}
export interface JobStatus {
  state: "running" | "done" | "error";
  result?: { timestamp: string; ok_count: number; error_count: number };
  error?: string;
}
export type ProgressEvent =
  | { type: "backup_start"; project_count: number; timestamp: string }
  | { type: "project_start"; index: number; project_name: string; total: number }
  | { type: "project_done"; index: number; project_name: string; file_count: number; missing_count: number }
  | { type: "project_error"; index: number; project_name: string; error: string }
  | { type: "backup_done"; ok_count: number; error_count: number };
