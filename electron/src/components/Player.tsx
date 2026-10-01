import { useEffect, useState } from "react";
import { makeApi } from "../api";

const api = makeApi();

// One shared <audio> for the whole app, so starting a song stops the last one.
// Components subscribe to know whether *their* file is the one playing.
type State = { path: string | null; playing: boolean; error: string | null };
let audio: HTMLAudioElement | null = null;
let state: State = { path: null, playing: false, error: null };
const subs = new Set<(s: State) => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  subs.forEach((f) => f(state));
}

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("playing", () => set({ playing: true, error: null }));
    audio.addEventListener("pause", () => set({ playing: false }));
    audio.addEventListener("ended", () => set({ playing: false }));
    audio.addEventListener("error", () => set({ playing: false, error: "Couldn't play this file" }));
  }
  return audio;
}

export function toggle(path: string) {
  const a = el();
  if (state.path === path && !a.paused) { a.pause(); return; }
  if (state.path !== path) {
    a.src = api.exportAudioUrl(path);
    set({ path, error: null });
  }
  a.play().catch(() => set({ playing: false, error: "Couldn't play this file" }));
}

export function stop() {
  if (audio) audio.pause();
}

export function usePlayer(path: string | null | undefined) {
  const [s, setS] = useState<State>(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  const mine = !!path && s.path === path;
  return { playing: mine && s.playing, error: mine ? s.error : null };
}

// Round ▶ / ❚❚ button for one export. Stops click-through so it can sit inside a row.
export function PlayButton({ path, title, size = 30 }: { path: string; title?: string; size?: number }) {
  const { playing, error } = usePlayer(path);
  return (
    <button type="button" className={`playbtn${playing ? " playbtn--on" : ""}`}
      style={{ width: size, height: size }}
      aria-label={playing ? "Pause" : `Play ${title ?? "song"}`}
      title={error ?? (playing ? "Pause" : `Play ${title ?? "the latest export"}`)}
      onClick={(e) => { e.stopPropagation(); toggle(path); }}
      onKeyDown={(e) => e.stopPropagation()}>
      {playing ? "❚❚" : "▶"}
    </button>
  );
}
