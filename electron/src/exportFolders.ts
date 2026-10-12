import { keep, recall } from "./desktop";

// The rows of Settings > Export folders: the user's own folders first, then the
// ones Backups found by itself, then Uploader's. A folder shows once, under the
// first of those it belongs to.
export type ExportFolderKind = "mine" | "found" | "uploader";
export const EXPORT_FOLDER_FROM: Record<ExportFolderKind, string> = {
  mine: "Added by you",
  found: "Found by itself",
  uploader: "From Uploader",
};

export function exportFolderRows(f: { folders: string[]; found_folders?: string[]; uploader_folders?: string[] } | null):
  { path: string; kind: ExportFolderKind }[] {
  if (!f) return [];
  const seen = new Set<string>();
  const out: { path: string; kind: ExportFolderKind }[] = [];
  const add = (paths: string[] | undefined, kind: ExportFolderKind) => {
    for (const p of paths ?? []) if (p && !seen.has(p)) { seen.add(p); out.push({ path: p, kind }); }
  };
  add(f.folders, "mine");
  add(f.found_folders, "found");
  add(f.uploader_folders, "uploader");
  return out;
}

// Settings > "Hide short exports": songs shorter than this many seconds (test bounces,
// clicks, one-shots) are left out of a project's songs list until you ask for them.
// 0 is off. Kept on this computer only; nothing is ever deleted.
export const SHORT_EXPORTS_KEY = "lc-hide-short-exports";
export const SHORT_EXPORTS_DEFAULT = 30;
export const shortExportSeconds = (): number =>
  recall<number>(SHORT_EXPORTS_KEY, SHORT_EXPORTS_DEFAULT, (v) => typeof v === "number" && v >= 0 && v <= 3600);
export const setShortExportSeconds = (n: number) => keep(SHORT_EXPORTS_KEY, Math.min(3600, Math.max(0, Math.round(n))));
// A song is short only when its length is known: an unknown length is never hidden.
export const isShortExport = (seconds: number | null | undefined, min: number) =>
  min > 0 && typeof seconds === "number" && seconds < min;
