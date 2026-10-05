import { useEffect, useRef, useState } from "react";
import { makeApi } from "../api";
import { coverColor } from "../look";
import { Cover } from "./Cover";
import { Icon } from "./Icon";
import { Wave } from "./Wave";
import { Meter } from "./Meter";

const api = makeApi();

// One shared <audio> for the whole app, so starting a song stops the last one.
// Components subscribe to know whether *their* file is the one playing; the player
// bar along the bottom shows whatever is loaded.
export interface SongMeta { title: string; project?: string; genre?: string | null }
type State = {
  path: string | null; playing: boolean; error: string | null;
  meta: SongMeta | null; time: number; duration: number;
};
let audio: HTMLAudioElement | null = null;
let state: State = { path: null, playing: false, error: null, meta: null, time: 0, duration: 0 };
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
    audio.addEventListener("timeupdate", () => set({ time: audio!.currentTime }));
    audio.addEventListener("durationchange", () => set({ duration: audio!.duration || 0 }));
    audio.addEventListener("error", () => set({ playing: false, error: "Couldn't play this file" }));
  }
  return audio;
}

export function toggle(path: string, meta?: SongMeta) {
  const a = el();
  if (state.path === path && !a.paused) { a.pause(); return; }
  if (state.path !== path) {
    a.src = api.exportAudioUrl(path);
    set({ path, error: null, meta: meta ?? { title: path.split(/[\\/]/).pop() || "Song" }, time: 0, duration: 0 });
  }
  a.play().catch(() => set({ playing: false, error: "Couldn't play this file" }));
}

// The Space bar: pause, or carry on with whatever is in the player bar. False when
// nothing is loaded, so the key is left alone.
export function togglePlaying(): boolean {
  if (!state.path) return false;
  toggle(state.path, state.meta ?? undefined);
  return true;
}

// Where the song is right now, read straight from the player (for the level meters).
export function now(): number {
  return audio ? audio.currentTime : 0;
}

export function seek(fraction: number) {
  if (audio && state.duration) audio.currentTime = fraction * state.duration;
}

export function stop() {
  if (audio) audio.pause();
}

export function close() {
  if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  set({ path: null, playing: false, meta: null, time: 0, duration: 0, error: null });
}

function usePlayerState() {
  const [s, setS] = useState<State>(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  return s;
}

export function usePlayer(path: string | null | undefined) {
  const s = usePlayerState();
  const mine = !!path && s.path === path;
  return { playing: mine && s.playing, error: mine ? s.error : null, played: mine && s.duration ? s.time / s.duration : 0 };
}

// ── waveforms: asked of the backup service first (WAV, AIFF); anything it can't
// read (MP3 and the like) is decoded here, one at a time, only once it's on screen.
const peakCache = new Map<string, number[] | null>();
const waiting = new Map<string, Promise<number[] | null>>();
let queue: Promise<unknown> = Promise.resolve();
const BARS = 120;

async function decodeHere(path: string): Promise<number[] | null> {
  const run = queue.then(async () => {
    try {
      const buf = await (await fetch(api.exportAudioUrl(path))).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const audioBuf = await ctx.decodeAudioData(buf);
      const ch = audioBuf.getChannelData(0);
      const step = Math.max(1, Math.floor(ch.length / BARS));
      const out: number[] = [];
      for (let i = 0; i < BARS; i++) {
        let m = 0;
        for (let j = i * step, end = Math.min(ch.length, j + step); j < end; j += 16) m = Math.max(m, Math.abs(ch[j]));
        out.push(m);
      }
      const top = Math.max(...out) || 1;
      return out.map((v) => Math.round((v / top) * 1000) / 1000);
    } catch { return null; }
  });
  queue = run;
  return run;
}

function loadPeaks(path: string): Promise<number[] | null> {
  if (peakCache.has(path)) return Promise.resolve(peakCache.get(path)!);
  let p = waiting.get(path);
  if (!p) {
    p = api.exportPeaks(path)
      .then((r) => r.peaks ?? decodeHere(path))
      .catch(() => null)
      .then((v) => { peakCache.set(path, v); waiting.delete(path); return v; });
    waiting.set(path, p);
  }
  return p;
}

// Peaks for one song, fetched once the returned ref's element scrolls into view.
export function usePeaks(path: string | null | undefined) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(path ? peakCache.get(path) ?? null : null);
  useEffect(() => {
    if (!path) return;
    if (peakCache.has(path)) { setPeaks(peakCache.get(path)!); return; }
    setPeaks(null);
    let alive = true;
    const go = () => loadPeaks(path).then((v) => { if (alive) setPeaks(v); });
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") { go(); return () => { alive = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } });
    io.observe(node);
    return () => { alive = false; io.disconnect(); };
  }, [path]);
  return { ref, peaks };
}

// A song's waveform that you can click to play from that point.
export function SongWave({ path, meta, height = 26 }: { path: string; meta: SongMeta; height?: number }) {
  const { ref, peaks } = usePeaks(path);
  const { played } = usePlayer(path);
  return (
    <div ref={ref} className="songwave" onClick={(e) => e.stopPropagation()}>
      <Wave peaks={peaks} color={coverColor(meta.genre, meta.project ?? meta.title)} played={played} height={height}
        onSeek={(f) => { if (state.path !== path) toggle(path, meta); setTimeout(() => seek(f), 60); }} />
    </div>
  );
}

// Round play / pause button for one export. Stops click-through so it can sit inside a row.
export function PlayButton({ path, title, size = 30, meta, className = "" }: {
  path: string; title?: string; size?: number; meta?: SongMeta; className?: string;
}) {
  const { playing, error } = usePlayer(path);
  return (
    <button type="button" className={`playbtn${playing ? " playbtn--on" : ""} ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-label={playing ? "Pause" : `Play ${title ?? "song"}`}
      title={error ?? (playing ? "Pause" : `Play ${title ?? "the latest export"}`)}
      onClick={(e) => { e.stopPropagation(); toggle(path, meta ?? (title ? { title } : undefined)); }}
      onKeyDown={(e) => e.stopPropagation()}>
      <Icon name={playing ? "pause" : "play"} size={Math.round(size * 0.4)} />
    </button>
  );
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// The bar along the bottom while a song is loaded: what it is, where you are, controls.
export function PlayerBar() {
  const s = usePlayerState();
  const { peaks } = usePeaks(s.path);
  useEffect(() => {
    document.documentElement.classList.toggle("has-player", !!s.path);
  }, [s.path]);
  if (!s.path || !s.meta) return null;
  const m = s.meta;
  return (
    <div className="playerbar" role="region" aria-label="Now playing">
      <Cover name={m.project ?? m.title} genre={m.genre} size={44} label={false} />
      <div className="playerbar__what">
        <div className="playerbar__title">{m.project ?? m.title}</div>
        <div className="playerbar__sub">{s.error ?? `${m.title} · latest song`}</div>
      </div>
      <button type="button" className="playbtn playerbar__play" onClick={() => toggle(s.path!, m)}
        aria-label={s.playing ? "Pause" : "Play"}>
        <Icon name={s.playing ? "pause" : "play"} size={14} />
      </button>
      <span className="playerbar__time">{clock(s.time)}</span>
      <Wave peaks={peaks} color={coverColor(m.genre, m.project ?? m.title)} played={s.duration ? s.time / s.duration : 0}
        height={36} onSeek={seek} className="playerbar__wave" />
      <span className="playerbar__time">{s.duration ? clock(s.duration) : "–:––"}</span>
      <Meter peaks={peaks} playing={s.playing} duration={s.duration} now={now} />
      <button type="button" className="iconbtn" onClick={close} aria-label="Close the player"><Icon name="close" /></button>
    </div>
  );
}
