import { toast, toastWarn } from "./components/Desktop";
import type { AlbumSync } from "./components/Albums";

// "Sync to SoundCloud" on an album page. Uploader is the app signed in to SoundCloud,
// so the album is handed to it: Uploader opens on the album and syncs it there. What it
// did shows here too, because both apps read the same album list.

const bridge = () => (window as any).ablebackup;

export const albumSync: AlbumSync = {
  label: "Sync to SoundCloud",
  hint: "Opens Uploader, which puts the album's Ready songs on SoundCloud as one private playlist, in album order. Nothing is posted twice.",
  start: (a) => {
    void Promise.resolve(bridge()?.openUploader?.(a.id)).then((opened) => {
      if (opened) toast(`Opening Uploader to sync ${a.title}.`);
      else toastWarn("Uploader does the syncing, and it isn't on this computer yet. It's free.",
        { label: "Get Uploader", onClick: () => void bridge()?.openExternal?.("https://lazycreatives.github.io/#download") });
    });
  },
  useStep: () => null,
};
