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
