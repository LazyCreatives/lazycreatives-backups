import { makeApi } from "./api";
import { toastWarn } from "./components/Desktop";
import { askNasSignIn } from "./components/NasSignIn";

const api = makeApi();
const bridge = () => (window as any).ablebackup;

/** Open a project in its music app (or show a stems-only folder). A project kept on
 *  the NAS gets its shared folder connected first, in case the NAS went to sleep. */
export async function openProjectFile(path: string | undefined, reveal = false): Promise<void> {
  if (!path) return;
  try {
    const r = await api.nasReady(path);
    if (r.reached === false && r.login) {
      toastWarn("Your NAS turned down the saved login on this computer, so the project can't open yet.",
        { label: "Log in again", onClick: () => askNasSignIn(() => { openProjectFile(path, reveal); }) });
      return;
    }
    if (r.reached === false) {
      toastWarn("No answer from your NAS, so the project can't open yet. Check the NAS is on, then try again.");
      return;
    }
    path = r.path || path;  // the shared folder may have come back at a new place
  } catch { /* not on the NAS, or the engine is busy: try anyway */ }
  if (reveal) bridge()?.revealPath?.(path);
  else bridge()?.openProject?.(path);
}
