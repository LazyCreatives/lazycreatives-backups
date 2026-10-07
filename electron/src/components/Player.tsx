import { useEffect, useRef, useState } from "react";
import { makeApi } from "../api";
import { coverColor } from "../look";
import { Cover } from "./Cover";
import { Icon } from "./Icon";
import { Wave, type WaveMark } from "./Wave";
import { AUDITION_DELAY, AUDITION_FROM, auditionOn, bindAuditionKeys, useAuditionMode } from "../audition";
import { Meter } from "./Meter";

const api = makeApi();

// One shared <audio> for the whole app, so starting a song stops the last one.
// Components subscribe to know whether *their* file is the one playing; the player
// bar along the bottom shows whatever is loaded.
// `projectId` opens the project from the player bar (the name is used when it's missing).
export interface SongMeta { title: string; project?: string; projectId?: string; genre?: string | null }
type State = {
  path: string | null; playing: boolean; error: string | null;
  meta: SongMeta | null; time: number; duration: number;
  auditioning: boolean;   // a preview on hover, not something chosen to play
};
let audio: HTMLAudioElement | null = null;
let state: State = { path: null, playing: false, error: null, meta: null, time: 0, duration: 0, auditioning: false };
// The song that was in the player bar before a preview took over, put back (paused)
// when the preview ends.
let before: { path: string; meta: SongMeta | null; time: number } | null = null;
let fade = 0;
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
    audio.addEventListener("error", () => {
      // The sidecar already decodes the formats the player is known to refuse. If one
      // still fails, ask once for it decoded before giving up.
      const a = audio!;
      if (state.path && !a.src.includes("&decode=1")) {
        const at = a.currentTime;
        a.src = api.exportAudioUrl(state.path, true);
        if (at) a.addEventListener("loadedmetadata", () => { a.currentTime = at; }, { once: true });
        if (wanted) a.play().catch(() => {}); else a.load();
        return;
      }
      set({ playing: false, error: "Couldn't play this file" });
    });
  }
  return audio;
}

// Whether the player should be playing (not paused), so a retry knows to carry on.
let wanted = false;
function start(a: HTMLAudioElement): Promise<void> {
  wanted = true;
  // a refusal shows up as the element's error (above), after the retry
  return a.play().catch(() => {});
}

export function toggle(path: string, meta?: SongMeta) {
  const a = el();
  if (state.auditioning) {
    window.clearInterval(fade); a.volume = 1; before = null;
    // pressing play on the song being previewed keeps it playing, now for real
    if (state.path === path) { set({ auditioning: false }); if (a.paused) start(a); return; }
    set({ auditioning: false });
  }
  if (state.path === path && !a.paused) { wanted = false; a.pause(); return; }
  if (state.path !== path) {
    a.src = api.exportAudioUrl(path);
    set({ path, error: null, meta: meta ?? { title: path.split(/[\\/]/).pop() || "Song" }, time: 0, duration: 0 });
  }
  start(a);
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
  wanted = false;
  if (audio) audio.pause();
}

// Preview a song: start about a third in, fade up, and leave the player bar alone.
export function audition(path: string, meta: SongMeta) {
  const a = el();
  if (state.path === path && !a.paused) return;
  if (state.path && !state.auditioning && !before) before = { path: state.path, meta: state.meta, time: a.currentTime };
  window.clearInterval(fade);
  a.volume = 0;
  a.src = api.exportAudioUrl(path);
  set({ path, error: null, meta, time: 0, duration: 0, auditioning: true });
  const jump = () => { if (state.path === path && a.duration) a.currentTime = a.duration * AUDITION_FROM; };
  a.addEventListener("loadedmetadata", jump, { once: true });
  start(a).then(() => {
    fade = window.setInterval(() => {
      a.volume = Math.min(1, a.volume + 0.1);
      if (a.volume >= 1) window.clearInterval(fade);
    }, 30);
  }).catch(() => set({ playing: false, auditioning: false }));
}

// Stop previewing `path` (if it is still the one previewing) and put back whatever
// was in the player bar before, paused where it was.
export function endAudition(path: string) {
  if (!state.auditioning || state.path !== path || !audio) return;
  window.clearInterval(fade);
  wanted = false;
  audio.pause();
  audio.volume = 1;
  const back = before;
  before = null;
  if (back) {
    audio.src = api.exportAudioUrl(back.path);
    audio.addEventListener("loadedmetadata", () => { if (audio) audio.currentTime = back.time; }, { once: true });
    audio.load();
    set({ path: back.path, meta: back.meta, time: back.time, playing: false, auditioning: false });
  } else {
    close();
  }
}

// Props for anything that stands for a song (a row, a cover): with previewing on,
// resting the pointer on it or moving onto it from the keyboard plays a preview.
export function useAudition(path: string | null | undefined, meta: SongMeta | undefined) {
  const [on] = useAuditionMode();
  const timer = useRef(0);
  useEffect(() => { bindAuditionKeys(); }, []);
  useEffect(() => () => { window.clearTimeout(timer.current); if (path) endAudition(path); }, [path]);
  if (!on || !path || !meta) return {};
  const start = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (auditionOn()) audition(path, meta); }, AUDITION_DELAY);
  };
  const end = () => { window.clearTimeout(timer.current); endAudition(path); };
  return { "data-audition": "", onMouseEnter: start, onMouseLeave: end, onFocus: start, onBlur: end };
}

// A row or card that previews its song on hover (see useAudition).
export function AuditionDiv({ song, meta, ...rest }: React.HTMLAttributes<HTMLDivElement> & {
  song?: string | null; meta?: SongMeta;
}) {
  const a = useAudition(song, meta);
  return <div {...rest} {...a} />;
}

export function close() {
  wanted = false;
  if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); audio.volume = 1; }
  set({ path: null, playing: false, meta: null, time: 0, duration: 0, error: null, auditioning: false });
}

function usePlayerState() {
  const [s, setS] = useState<State>(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  return s;
}

export function usePlayer(path: string | null | undefined) {
  const s = usePlayerState();
  const mine = !!path && s.path === path;
  return { playing: mine && s.playing, error: mine ? s.error : null, played: mine && s.duration ? s.time / s.duration : 0,
    auditioning: mine && s.auditioning };
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

// How long a song is, in seconds (0 until known): read from the file's header only.
const lengths = new Map<string, number>();
export function useSongLength(path: string | null | undefined): number {
  const [len, setLen] = useState(path ? lengths.get(path) ?? 0 : 0);
  useEffect(() => {
    if (!path) { setLen(0); return; }
    if (lengths.has(path)) { setLen(lengths.get(path)!); return; }
    setLen(0);
    const a = new Audio();
    a.preload = "metadata";
    const done = () => { if (a.duration && isFinite(a.duration)) { lengths.set(path, a.duration); setLen(a.duration); } };
    a.addEventListener("loadedmetadata", done, { once: true });
    a.src = api.exportAudioUrl(path);
    return () => { a.removeEventListener("loadedmetadata", done); a.removeAttribute("src"); a.load(); };
  }, [path]);
  return len;
}

// A song's waveform that you can click to play from that point.
export function SongWave({ path, meta, height = 26, marks }: { path: string; meta: SongMeta; height?: number; marks?: WaveMark[] }) {
  const { ref, peaks } = usePeaks(path);
  const { played } = usePlayer(path);
  return (
    <div ref={ref} className="songwave" onClick={(e) => e.stopPropagation()}>
      <Wave peaks={peaks} color={coverColor(meta.genre, meta.project ?? meta.title)} played={played} height={height} marks={marks}
        onSeek={(f) => { if (state.path !== path || state.auditioning) toggle(path, meta); setTimeout(() => seek(f), 60); }} />
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
// The project's name opens its page; the cover (or its up arrow) opens the big view.
export function PlayerBar({ onOpenProject }: { onOpenProject?: (key: string) => void }) {
  const s = usePlayerState();
  const { peaks } = usePeaks(s.path);
  const [big, setBig] = useState(false);
  const shown = !!s.path && !s.auditioning;
  useEffect(() => {
    document.documentElement.classList.toggle("has-player", shown);
    if (!shown) setBig(false);
  }, [shown]);
  if (!shown || !s.meta) return null;
  const m = s.meta;
  const key = m.projectId ?? m.project;
  const open = key && onOpenProject ? () => { setBig(false); onOpenProject(key); } : undefined;
  const name = m.project ?? m.title;
  const played = s.duration ? s.time / s.duration : 0;
  const color = coverColor(m.genre, name);
  return (
    <>
      <div className="playerbar" role="region" aria-label="Now playing">
        <button type="button" className="playerbar__art" onClick={() => setBig(true)}
          aria-label="Make the player bigger" title="Make the player bigger">
          <Cover name={name} genre={m.genre} size={44} label={false} />
          <span className="playerbar__grow"><Icon name="chevronUp" size={14} /></span>
        </button>
        <div className="playerbar__what">
          {open
            ? <button type="button" className="playerbar__title playerbar__link" onClick={open} title={`Open ${name}`}>{name}</button>
            : <div className="playerbar__title">{name}</div>}
          <div className="playerbar__sub">{s.error ?? `${m.title} · latest song`}</div>
        </div>
        <button type="button" className="playbtn playerbar__play" onClick={() => toggle(s.path!, m)}
          aria-label={s.playing ? "Pause" : "Play"}>
          <Icon name={s.playing ? "pause" : "play"} size={14} />
        </button>
        <span className="playerbar__time">{clock(s.time)}</span>
        <Wave peaks={peaks} color={color} played={played}
          height={36} onSeek={seek} duration={s.duration} className="playerbar__wave" />
        <span className="playerbar__time">{s.duration ? clock(s.duration) : "–:––"}</span>
        <Meter peaks={peaks} playing={s.playing} duration={s.duration} now={now} />
        <button type="button" className="iconbtn" onClick={close} aria-label="Close the player"><Icon name="close" /></button>
      </div>
      {big && (
        <NowPlaying color={color} onClose={() => setBig(false)}
          art={<Cover name={name} genre={m.genre} className="nowplaying__cover" />}
          title={name} sub={s.error ?? `${m.title} · latest song`} open={open} openLabel="Open project"
          playing={s.playing} onPlay={() => toggle(s.path!, m)}
          wave={<Wave peaks={peaks} color={color} played={played} height={88} onSeek={seek} duration={s.duration} className="nowplaying__wave" />}
          time={s.time} duration={s.duration}
          meter={<Meter peaks={peaks} playing={s.playing} duration={s.duration} now={now} />} />
      )}
    </>
  );
}

// The player made big, over the page: a large cover, the name (opens its page), the
// waveform to scrub and the controls. The down arrow or Escape shrinks it back.
function NowPlaying({ color, art, title, sub, open, openLabel, playing, onPlay, wave, time, duration, meter, onClose }: {
  color: string; art: React.ReactNode; title: string; sub: string; open?: () => void; openLabel: string;
  playing: boolean; onPlay: () => void; wave: React.ReactNode; time: number; duration: number;
  meter: React.ReactNode; onClose: () => void;
}) {
  const shrink = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    shrink.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="nowplaying" role="dialog" aria-modal="true" aria-label="Now playing"
      style={{ "--np-tint": color } as React.CSSProperties}>
      <div className="nowplaying__top">
        <button type="button" ref={shrink} className="iconbtn" onClick={onClose}
          aria-label="Make the player smaller" title="Make the player smaller (Esc)"><Icon name="chevronDown" /></button>
        <span className="nowplaying__label">Now playing</span>
        <span />
      </div>
      <div className="nowplaying__body">
        {art}
        <div className="nowplaying__what">
          {open
            ? <button type="button" className="nowplaying__title playerbar__link" onClick={open} title={openLabel}>{title}</button>
            : <div className="nowplaying__title">{title}</div>}
          <div className="nowplaying__sub">{sub}</div>
        </div>
        <div className="nowplaying__deck">
          <span className="playerbar__time">{clock(time)}</span>
          {wave}
          <span className="playerbar__time">{duration ? clock(duration) : "–:––"}</span>
        </div>
        <div className="nowplaying__controls">
          <span />
          <button type="button" className="playbtn playerbar__play nowplaying__play" onClick={onPlay}
            aria-label={playing ? "Pause" : "Play"}>
            <Icon name={playing ? "pause" : "play"} size={22} />
          </button>
          <span className="nowplaying__meter">{meter}</span>
        </div>
        {open && <button type="button" className="btn nowplaying__open" onClick={open}>{openLabel}</button>}
      </div>
    </div>
  );
}
