// Turns what the engine says when something fails into plain words for people.
// The engine answers in short programmer notes ("no such picture", a bare "500");
// every screen shows error.message as it is, so the wording is fixed here, once.
// SHARED FILE: identical in Backups and Uploader (electron/src/plainProblem.ts).

const REPORT = "Try again, and if it keeps happening use Help, Report a problem.";
export const LOST_ENGINE = "The app lost touch with its engine. Close and reopen the app; your files are fine.";
const BAD_PICTURE = "That picture couldn't be read. Save it again as a JPEG or PNG and pick it again.";

const PLAIN: Record<string, string> = {
  "invalid or missing token": LOST_ENGINE,
  "no such picture": "That picture isn't there any more. Pick it again.",
  "not a data URL": BAD_PICTURE,
  "picture data must be base64": BAD_PICTURE,
  "picture data is not valid base64": BAD_PICTURE,
  "picture data does not match its type": BAD_PICTURE,
  "pictures must be JPEG, PNG or WebP": "That picture isn't a JPEG, PNG or WebP. Pick one of those.",
  "picture is too big (12 MB at most)": "That picture is over 12 MB. Pick a smaller one.",
  "not an audio file": "That file isn't a song the app can play.",
  "this file can't be played": "That file can't be played here. Try a WAV or MP3 export of it.",
  "unknown project": "That project isn't in your library any more.",
  "not a project in the library": "That project isn't in your library any more.",
  "project not found on disk": "That project isn't where it was. It may have been moved or renamed.",
  "not a recognized project file": "That isn't a project file the app knows how to read.",
  "not in the list": "That song isn't linked to this project any more.",
  "not linked": "That song isn't linked to this project any more.",
  "not a linked export": "That song isn't linked to this project any more.",
  "unknown job": "That job has already finished.",
  "job not running": "That job has already finished.",
  "unknown snapshot": "That backup isn't there any more.",
  "snapshot has no recorded folder": "That backup doesn't say which folder it came from, so it can't go back there.",
  "not a known mix": "That song isn't in the list any more. It may have been moved or deleted.",
  "not a SoundCloud waveform": "SoundCloud didn't send a waveform for that track.",
};

/** Plain words for a failed engine call. `detail` is what the engine sent (if anything). */
export function plainProblem(detail: unknown, status = 0): string {
  if (status === 0) return LOST_ENGINE; // the engine didn't answer at all
  if (typeof detail === "string" && detail.trim()) {
    const d = detail.trim();
    if (PLAIN[d]) return PLAIN[d];
    // Already written for people (a sentence, starting with a capital): keep it.
    if (/^[A-Z“"']/.test(d) && !/^\d+$/.test(d)) return d;
  }
  if (status === 401 || status === 403) return LOST_ENGINE;
  return `Something went wrong inside the app. ${REPORT}`;
}
