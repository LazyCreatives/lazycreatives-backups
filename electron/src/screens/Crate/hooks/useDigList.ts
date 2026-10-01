import { useMemo } from "react";
import type { Project, DigSort } from "../types";
import { parseStamp } from "../types";

// Pure: filter (verified-only) + sort the records inside a crate for the dig view.
export function sortDigList(projects: Project[], sort: DigSort, verifiedOnly: boolean): Project[] {
  const list = (verifiedOnly ? projects.filter((p) => p.verified) : projects.slice());
  list.sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name)
    : sort === "bpm" ? (b.bpm ?? 0) - (a.bpm ?? 0)
    : sort === "size" ? b.sizeBytes - a.sizeBytes
    : parseStamp(b.modifiedAt) - parseStamp(a.modifiedAt));  // recent (default)
  return list;
}

export function useDigList(projects: Project[], sort: DigSort, verifiedOnly: boolean): Project[] {
  return useMemo(() => sortDigList(projects, sort, verifiedOnly), [projects, sort, verifiedOnly]);
}
