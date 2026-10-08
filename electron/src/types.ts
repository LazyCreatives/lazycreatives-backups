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
// A usual project folder found on this computer (first-run setup).
export interface SuggestedFolder { path: string; label: string; count: number; }
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
export interface LibraryItem {
  project_id: string;
  name: string;
  path: string;
  dir: string;
  daw?: string;
  owner: string;
  size: number;
  mtime: number;
  missing_count: number;
  genre?: string | null;       // the producer's pick, else the guess from the last scan
  genre_emoji?: string | null;
  genre_guess?: string | null; // what the app guessed (tempo + name)
  genre_by_you?: number | boolean | null; // set when the producer picked the genre
  bpm?: number | null;
  tracks?: number | null;      // content track/lane count (null if the format hides it)
  plugins?: string[];          // plugin names the project uses
  found_at: string;
  last_backup: string | null;
  snapshot_count: number;
  backed_up: boolean;
  changed?: boolean;           // saved in the DAW since its last backup
  in_folders?: boolean;        // inside a project folder from Settings (what Home's big button backs up)
  export_count?: number;       // song renders linked to this project
  latest_export?: { path: string; name: string; mtime: number; uploaded: boolean } | null;
}
export interface ExportUpload { title: string; url: string | null; uploaded_at: string; path?: string }
export interface ExportRow {
  path: string;
  project_id: string;
  name: string;
  size: number | null;
  mtime: number | null;
  match: "folder" | "name" | "manual";
  kind?: "song" | "stem";        // a stem is one part of the song (kick, vocals…)
  why?: string | null;           // plain words for the clue that linked it
  sure?: number;                 // 0: a guess (dotted underline)
  exists: boolean;
  upload: ExportUpload | null;   // on SoundCloud (via Uploader), if it was uploaded
}
// A song in an exports folder that no project matched, with the likeliest project.
export interface UnmatchedSong {
  path: string;
  name: string;
  size: number | null;
  mtime: number | null;
  kind: "song" | "stem";
  suggest_id: string | null;
  suggest_why: string | null;
  exists: boolean;
}
export interface ProjectExports {
  project_id: string;
  exports: ExportRow[];
  uploads_elsewhere: ExportUpload[];  // uploads Uploader linked to this project whose file moved
  uploader_installed: boolean;
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
  beta?: boolean;   // free beta: everything unlocked, plan box hidden
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
  result?: {
    timestamp?: string; ok_count?: number; error_count?: number; skipped_count?: number; path?: string;
    errors?: { project_name: string; path?: string; error: string }[];  // which projects failed, and why
  };
  error?: string;
}
export type ProgressEvent =
  | { type: "scan_searching"; dirs: number; found: number }
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

// A cloud app's synced folder (Dropbox, Google Drive, …); path is null when not found.
export interface CloudFolder {
  key: string;
  label: string;
  path: string | null;
}

// "Tidy names": what renaming a song's versions, folder and songs would do.
export type TidyKind = "folder" | "version" | "song";
// rename: will change · same: already right · kept: must keep its name (note says why)
// blocked: can't (note says why) · skipped: the person unticked it
export type TidyStatus = "rename" | "same" | "kept" | "blocked" | "skipped";
export interface TidyRow {
  kind: TidyKind; old: string; new: string; old_name: string; new_name: string;
  status: TidyStatus; note: string; version?: number; project_id?: string; uploaded?: boolean;
}
export interface TidyGroup {
  id: string; name: string; suggested: string; folder: string; rows: TidyRow[];
  count: number; versions: number; songs: number;
}
export interface TidyPlan { groups: TidyGroup[]; count: number }
export interface TidyOptions {
  project_ids: string[]; names?: Record<string, string>; style?: "v" | "v0"; numbers?: "keep" | "order";
  song_style?: "paren" | "dash"; folder?: boolean; overrides?: Record<string, string>; skip?: string[];
}
export interface TidyDone { batch_id: string; renamed: number; id_map: Record<string, string>; summary: string }
export interface TidyBatch { id: string; at: string; summary: string; count: number }

// A plug-in installed on this computer (the Plugins page). One row however many
// formats it comes in; places says where each one is.
export type PluginFormat = "VST3" | "AU" | "CLAP" | "VST2" | "AAX" | "LV2";
export interface PluginRow {
  id: string;
  name: string;
  maker: string;                 // "" when the plug-in doesn't say and its folder doesn't either
  kind: "" | "Instrument" | "Effect";
  formats: PluginFormat[];
  places: { format: PluginFormat; path: string }[];
  used_in: number;               // scanned projects that use it
  used_by: string[];             // a few of their names
}
export interface PluginFolder { path: string; yours: boolean; exists: boolean; count: number }
export interface PluginList {
  plugins: PluginRow[];
  folders: PluginFolder[];
  scanned_at: number;
  complete: boolean;
  projects_scanned: number;
}
