import { makeApi } from "./api";

const api = makeApi();
const bridge = () => (window as any).ablebackup;

/** Open a project in its music app (or show a stems-only folder). A project kept on
 *  the NAS gets its shared folder connected first, in case the NAS went to sleep. */
export async function openProjectFile(path: string | undefined, reveal = false): Promise<void> {
  if (!path) return;
  try { await api.nasReady(path); } catch { /* not on the NAS, or no answer: try anyway */ }
  if (reveal) bridge()?.revealPath?.(path);
  else bridge()?.openProject?.(path);
}
