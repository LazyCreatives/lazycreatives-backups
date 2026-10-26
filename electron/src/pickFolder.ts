import { makeApi } from "./api";
import { toastWarn } from "./components/Desktop";

const api = makeApi();

// Every "Add folder" and "Choose…" opens the computer's own folder picker. It only
// gets into the NAS if the computer has the NAS login, which Backups keeps itself, so
// first Backups lets the computer in (waiting a few seconds at most for a sleeping
// NAS). After a folder on the NAS is picked and saved, its shared folder is connected
// again by itself, like the backup folder. `start`: open the picker there.
export async function pickFolder(start?: string): Promise<string | null> {
  try {
    const r = await Promise.race([api.nasBeforePick(), new Promise<null>((ok) => setTimeout(() => ok(null), 8000))]);
    if (r?.login) toastWarn("Your NAS didn't let Backups in, so its folders may not open. Log in again in Settings, Backups.");
  } catch { /* no NAS, or the engine is busy: the picker still opens */ }
  const dir = await (window as any).ablebackup?.pickFolder?.(start);
  return typeof dir === "string" && dir ? dir : null;
}
