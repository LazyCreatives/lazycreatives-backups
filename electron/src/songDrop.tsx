import { useRef, useState, useSyncExternalStore } from "react";
import { makeApi } from "./api";
import { askConfirm, toast, toastWarn } from "./components/Desktop";

const api = makeApi();

// Drag a song (an audio file) from Finder / Explorer onto a project's row, cover or
// page, and it's linked to that project. Only the link is recorded: the audio file
// itself is never moved, copied or changed.

export const SONG_FILE = /\.(wav|aiff?|aifc|flac|mp3|aac|m4a|ogg|wma|opus)$/i;
// Fired after songs are linked (or a link is undone), so open lists can refresh.
export const SONGS_LINKED = "lc-songs-linked";

export interface DropProject { project_id: string; name: string }
export interface DropSong {
  path: string; name: string;
  status: "ok" | "here" | "elsewhere" | "not_audio" | "missing" | "linked";
  others: DropProject[];
}

const hasFiles = (e: { dataTransfer: DataTransfer | null }) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

// True when what's being dragged looks like audio. While dragging the computer only
// says what kind of file each one is, not its name, so an unknown kind counts as no.
export function isSongDrag(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const items = Array.from(dt.items || []);
  return items.some((i) => i.kind === "file" && i.type.startsWith("audio/"));
}

// ── is a song being dragged over the window right now? ──────────────────────
let songDrag = false;
const subs = new Set<() => void>();
let listening = false;
function setSongDrag(v: boolean) {
  if (songDrag === v) return;
  songDrag = v;
  subs.forEach((f) => f());
}
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    setSongDrag(isSongDrag(e.dataTransfer));
  }, true);
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setSongDrag(false);
  }, true);
  const end = () => { depth = 0; setSongDrag(false); };
  window.addEventListener("drop", end, true);
  window.addEventListener("dragend", end, true);
}
export function useSongDragActive(): boolean {
  listen();
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => songDrag, () => false);
}

// A drop that a project took: the window-wide drop (add a folder) skips it.
let claimed = 0;
export function claimedBySong(): boolean {
  const mine = performance.now() - claimed < 2000;
  claimed = 0;
  return mine;
}

const listNames = (names: string[]) =>
  names.length === 1 ? `“${names[0]}”` : `${names.length} songs`;

// Link dropped files to a project: asks first when a song already belongs to another
// project, then says what happened with an Undo.
export async function linkSongs(paths: string[], project: DropProject): Promise<void> {
  let check: DropSong[];
  try {
    check = (await api.dropCheck(paths, project.project_id)).songs;
  } catch {
    toastWarn("Couldn't link that song. Try again from the project's Songs tab.");
    return;
  }
  const by = (s: DropSong["status"]) => check.filter((c) => c.status === s);
  const fresh = by("ok"), here = by("here"), elsewhere = by("elsewhere");
  const notSongs = by("not_audio").length, gone = by("missing").length;

  let move = false;
  if (elsewhere.length) {
    const other = elsewhere[0].others[0]?.name ?? "another project";
    move = await askConfirm(elsewhere.length === 1 ? {
      title: `“${elsewhere[0].name}” is linked to ${other}`,
      body: `Move it to ${project.name}? The song file stays exactly where it is.`,
      confirm: `Move to ${project.name}`, cancel: fresh.length ? "Skip it" : "Cancel",
    } : {
      title: `${elsewhere.length} of these songs are linked to other projects`,
      body: `Move them to ${project.name}? The song files stay exactly where they are.`,
      confirm: `Move to ${project.name}`, cancel: fresh.length ? "Skip them" : "Cancel",
    });
    if (!move && !fresh.length) return;
  }

  if (!fresh.length && !move) {
    if (here.length) toast(`${listNames(here.map((h) => h.name))} ${here.length === 1 ? "is" : "are"} already linked to ${project.name}.`);
    else if (notSongs) toastWarn(notSongs === 1 && paths.length === 1
      ? "That isn't a song. Drop an audio file (WAV, AIFF, FLAC, MP3 and so on)."
      : "None of those are songs. Drop audio files (WAV, AIFF, FLAC, MP3 and so on).");
    else if (gone) toastWarn("Couldn't find that file. It may have been moved.");
    return;
  }

  let r: { linked: string[]; token: string };
  try {
    r = await api.dropSongs(paths, project.project_id, move);
  } catch {
    toastWarn("Couldn't link that song. Try again from the project's Songs tab.");
    return;
  }
  if (!r.linked.length) return;
  window.dispatchEvent(new CustomEvent(SONGS_LINKED, { detail: { project_id: project.project_id } }));
  const skipped = notSongs + gone;
  const extra = skipped ? ` Skipped ${skipped} that ${skipped === 1 ? "isn't a song" : "aren't songs"}.` : "";
  toast(`Linked ${listNames(r.linked)} to ${project.name}.${extra}`, {
    label: "Undo",
    onClick: async () => {
      try {
        await api.dropUndo(r.token);
        window.dispatchEvent(new CustomEvent(SONGS_LINKED, { detail: { project_id: project.project_id } }));
        toast("Link undone.");
      } catch {
        toastWarn("Couldn't undo that link. Remove it from the project's Songs tab.");
      }
    },
  });
}

// Props for anything a song can be dropped on: a Library row, a cover, a project page.
// `over` is true while a file is held over it (for the highlight).
export function useSongDrop(project: DropProject | null) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const proj = useRef(project);
  proj.current = project;
  if (!project) return { over: false, props: {} };
  const props = {
    "data-songdrop": over ? "over" : undefined,
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();  // keep the "link" pointer (the window would say "copy")
      e.dataTransfer.dropEffect = "link";
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const bridge = (window as any).ablebackup;
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => bridge?.pathForFile?.(f) || (f as any).path || "").filter(Boolean);
      if (!paths.length || !proj.current) return;
      claimed = performance.now();
      linkSongs(paths, proj.current);
    },
  };
  return { over, props };
}

// The same as a component, so each row of a list keeps its own highlight.
export function SongDropTarget({ project, as: As, children, ...rest }:
  { project: DropProject; as: any; children?: React.ReactNode; [prop: string]: any }) {
  const { props } = useSongDrop(project);
  return <As {...rest} {...props}>{children}</As>;
}
