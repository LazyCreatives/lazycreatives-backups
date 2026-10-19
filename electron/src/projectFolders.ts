import { useEffect, useState } from "react";
import { makeApi } from "./api";

// Folders you sort your projects into: a name and the projects in it. A project can
// sit in as many folders as you like. Folders belong to the apps: putting a project
// in one never moves or changes a file. SHARED FILE: the same file lives in Backups
// and Uploader (electron/src/projectFolders.ts). Both apps read and change one list, kept
// on this computer beside the shared albums list, so a folder made in one app shows
// in the other (and on the phone). While a page shows folders, the list is checked
// every few seconds for changes made in the other app.

export interface Folder {
  id: string;
  name: string;
  project_ids: string[];   // Backups project ids, the newest added first
  created_at: number;
  updated_at: number;
}

// What a project drag carries (a row or card dragged onto a folder tile).
export const PROJECT_DRAG = "application/x-lc-projects";
export const MAX_NAME = 80;

const api = makeApi();
type State = { list: Folder[] | null; rev: number; error: string | null };
let state: State = { list: null, rev: -1, error: null };
const subs = new Set<(s: State) => void>();
const tell = (s: State) => { state = s; subs.forEach((f) => f(s)); };
let poll = 0;
let loading: Promise<void> | null = null;

export function loadFolders(): Promise<void> {
  if (loading) return loading;
  loading = api.listFolders()
    .then((r) => tell({ list: r.folders, rev: r.rev, error: null }))
    .catch((e) => tell({ ...state, list: state.list ?? [], error: String((e as Error).message) }))
    .finally(() => { loading = null; });
  return loading;
}

async function checkForChanges() {
  try {
    const { rev } = await api.foldersRev();
    if (rev !== state.rev) await loadFolders();
  } catch { /* the next check will try again */ }
}

export function useFolders(): Folder[] {
  const [s, setS] = useState<State>(state);
  useEffect(() => {
    subs.add(setS);
    void loadFolders();
    if (subs.size === 1) poll = window.setInterval(() => void checkForChanges(), 4000);
    return () => { subs.delete(setS); if (!subs.size) window.clearInterval(poll); };
  }, []);
  return s.list ?? [];
}

export const folderList = (): Folder[] => state.list ?? [];

// The folders a project is in, by name, for a row's small "in" line.
export function foldersOf(projectId: string, list: Folder[] = folderList()): Folder[] {
  return list.filter((f) => f.project_ids.includes(projectId));
}

// Only the projects in a folder, in the order they came (null folder = all of them).
export function inFolder<T extends { project_id?: string | null }>(items: T[], folder: Folder | null | undefined): T[] {
  if (!folder) return items;
  const ids = new Set(folder.project_ids);
  return items.filter((i) => !!i.project_id && ids.has(i.project_id));
}

// How many of the projects there are now are in each folder (a project that was
// deleted or isn't found by a scan any more doesn't count).
export function folderCount(folder: Folder, known: Set<string> | null): number {
  return known ? folder.project_ids.filter((id) => known.has(id)).length : folder.project_ids.length;
}

function put(f: Folder): Folder {
  const list = state.list ?? [];
  tell({ ...state, list: list.some((x) => x.id === f.id) ? list.map((x) => (x.id === f.id ? f : x)) : [...list, f] });
  void checkForChanges();
  return f;
}

// Show a change straight away, then save it; put it back if saving fails.
async function change(id: string, show: (f: Folder) => Folder, save: () => Promise<Folder>): Promise<Folder> {
  const before = state.list;
  if (before) tell({ ...state, list: before.map((f) => (f.id === id ? show(f) : f)) });
  try { return put(await save()); }
  catch (e) { if (before) tell({ ...state, list: before }); throw e; }
}

const tidy = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

export const makeFolder = async (name: string, projectIds: string[] = []) =>
  put(await api.createFolder(tidy(name) || "New folder", projectIds));

export const renameFolder = (id: string, name: string) =>
  change(id, (f) => ({ ...f, name: tidy(name) || f.name }), () => api.renameFolder(id, tidy(name) || "New folder"));

export const addToFolder = (id: string, projectIds: string[]) =>
  change(id, (f) => ({ ...f, project_ids: [...projectIds.filter((p) => !f.project_ids.includes(p)), ...f.project_ids] }),
    () => api.addToFolder(id, projectIds));

export const takeOutOfFolder = (id: string, projectIds: string[]) =>
  change(id, (f) => ({ ...f, project_ids: f.project_ids.filter((p) => !projectIds.includes(p)) }),
    () => api.removeFromFolder(id, projectIds));

// The folder goes; its projects stay where they are. Returns a way to bring it back.
export async function deleteFolder(id: string): Promise<() => Promise<void>> {
  const gone = folderList().find((f) => f.id === id);
  const before = state.list;
  if (before) tell({ ...state, list: before.filter((f) => f.id !== id) });
  try { await api.deleteFolder(id); }
  catch (e) { if (before) tell({ ...state, list: before }); throw e; }
  void checkForChanges();
  return async () => {
    if (!gone) return;
    const back = await makeFolder(gone.name, [...gone.project_ids].reverse());
    const order = folderList().map((f) => f.id);
    const at = (before ?? []).findIndex((f) => f.id === id);
    if (at >= 0) {
      const ids = order.filter((x) => x !== back.id);
      ids.splice(at, 0, back.id);
      await moveFolders(ids);
    }
  };
}

export async function moveFolders(ids: string[]) {
  const before = state.list ?? [];
  tell({ ...state, list: ids.map((id) => before.find((f) => f.id === id)!).filter(Boolean) });
  try { tell({ ...state, list: (await api.orderFolders(ids)).folders }); }
  catch (e) { tell({ ...state, list: before }); throw e; }
}

// The project ids a drag carries, or [] when it isn't a project drag.
export function draggedProjects(dt: DataTransfer | null): string[] {
  if (!dt || !Array.from(dt.types || []).includes(PROJECT_DRAG)) return [];
  try {
    const v = JSON.parse(dt.getData(PROJECT_DRAG) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
export const isProjectDrag = (dt: DataTransfer | null) => !!dt && Array.from(dt.types || []).includes(PROJECT_DRAG);

// Start dragging projects (one row, or every ticked one when the row is ticked).
export function startProjectDrag(e: React.DragEvent, ids: string[], label: string) {
  e.dataTransfer.setData(PROJECT_DRAG, JSON.stringify(ids));
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "copyLink";
  const ghost = document.createElement("div");
  ghost.className = "folderdrag";
  ghost.textContent = ids.length > 1 ? `${ids.length} projects` : label;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 14, 14);
  window.setTimeout(() => ghost.remove(), 0);
}
