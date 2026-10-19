import { useEffect, useState } from "react";
import { makeApi } from "./api";
import { stop as stopPlayer } from "./components/Player";

const api = makeApi();

// Play every part of one stem set together, like a mixing desk: a fader, mute and
// solo on every part and on every group (Drums, Bass…), and a level meter on each.
// One set at a time; starting it stops the main player. Each part is its own
// <audio>, nudged back into step with the first part whenever it drifts, and runs
// through its own gain (fader + mute) and level reader.

export type Mix = {
  setId: string | null;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  muted: string[];        // parts
  soloed: string[];
  groupMuted: string[];   // groups
  groupSoloed: string[];
  faders: Record<string, number>;       // part path -> 0..1 (missing = 1)
  groupFaders: Record<string, number>;  // group id -> 0..1
  error: string | null;
};

// Heard or not. A muted part or group is silent; once anything is soloed, only the
// soloed parts and the parts of soloed groups play.
export function partHeard(path: string, group: string,
  m: Pick<Mix, "muted" | "soloed" | "groupMuted" | "groupSoloed">): boolean {
  if (m.muted.includes(path) || m.groupMuted.includes(group)) return false;
  if (m.soloed.length || m.groupSoloed.length) return m.soloed.includes(path) || m.groupSoloed.includes(group);
  return true;
}

// A fader position as decibels, the way a desk prints it.
export function faderDb(v: number): string {
  if (v <= 0.0005) return "−∞";
  const db = 20 * Math.log10(v);
  return `${db > 0.05 ? "+" : db < -0.05 ? "−" : ""}${Math.abs(db).toFixed(1)}`;
}

const DRIFT = 0.04;  // seconds out of step before a part is nudged back
const EMPTY: Mix = { setId: null, playing: false, loading: false, time: 0, duration: 0, muted: [], soloed: [],
  groupMuted: [], groupSoloed: [], faders: {}, groupFaders: {}, error: null };
let mix: Mix = EMPTY;
type Part = { path: string; group: string; a: HTMLAudioElement; gain?: GainNode; level?: AnalyserNode };
let parts: Part[] = [];
let ctx: AudioContext | null = null;
let timer = 0;
const buf = new Float32Array(1024);
const subs = new Set<(m: Mix) => void>();

function set(next: Partial<Mix>) {
  mix = { ...mix, ...next };
  subs.forEach((f) => f(mix));
}

function applyGains() {
  for (const p of parts) {
    const on = partHeard(p.path, p.group, mix);
    const v = on ? (mix.faders[p.path] ?? 1) * (mix.groupFaders[p.group] ?? 1) : 0;
    if (p.gain && ctx) p.gain.gain.setTargetAtTime(v, ctx.currentTime, 0.015);
    else p.a.volume = Math.min(1, v);
  }
}

// Route a part through Web Audio for its fader and meter. Without Web Audio it still
// plays, with the element's own volume.
function wire(p: Part) {
  try {
    ctx ??= new AudioContext();
    const src = ctx.createMediaElementSource(p.a);
    p.gain = ctx.createGain();
    p.level = ctx.createAnalyser();
    p.level.fftSize = 1024;
    src.connect(p.gain).connect(p.level).connect(ctx.destination);
  } catch { /* plays without meters */ }
}

function ready(a: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    if (a.readyState >= 3) return resolve();
    const done = () => { a.removeEventListener("canplay", done); a.removeEventListener("error", done); resolve(); };
    a.addEventListener("canplay", done);
    a.addEventListener("error", done);
    window.setTimeout(done, 10000);
  });
}

function keepInStep() {
  const lead = parts[0]?.a;
  if (!lead) return;
  set({ time: lead.currentTime, duration: lead.duration || mix.duration });
  for (const { a } of parts.slice(1)) {
    if (!a.paused && !a.ended && Math.abs(a.currentTime - lead.currentTime) > DRIFT) a.currentTime = lead.currentTime;
  }
}

function teardown() {
  window.clearInterval(timer);
  for (const p of parts) {
    p.a.pause(); p.a.removeAttribute("src"); p.a.load();
    try { p.gain?.disconnect(); p.level?.disconnect(); } catch { /* already gone */ }
  }
  parts = [];
}

async function playAll() {
  stopPlayer();
  await ctx?.resume().catch(() => {});
  const at = parts[0].a.currentTime;
  for (const { a } of parts) a.currentTime = at;
  await Promise.all(parts.map(({ a }) => a.play().catch(() => {})));
  window.clearInterval(timer);
  timer = window.setInterval(keepInStep, 250);
}

// Start (or pause, or carry on with) a set. The mix (faders, mutes, solos) is kept
// while the same set stays loaded.
export async function playStems(setId: string, list: { path: string; group: string }[]) {
  if (mix.setId === setId && parts.length) {
    if (mix.playing) { pauseStems(); return; }
    await playAll();
    set({ playing: true });
    return;
  }
  // a mix set up before pressing play (see armStems) is kept
  const { muted, soloed, groupMuted, groupSoloed, faders, groupFaders } = mix.setId === setId ? mix : EMPTY;
  teardown();
  stopPlayer();
  set({ ...EMPTY, setId, loading: true, muted, soloed, groupMuted, groupSoloed, faders, groupFaders });
  parts = list.map(({ path, group }) => {
    const a = new Audio();
    a.crossOrigin = "anonymous";  // lets the meters read the sound from the app's own service
    a.preload = "auto";
    // a format the player refuses is asked for once more, decoded by the app's service
    a.addEventListener("error", () => { if (a.src && !a.src.includes("&decode=1")) a.src = api.exportAudioUrl(path, true); }, { once: true });
    a.src = api.exportAudioUrl(path);
    const p: Part = { path, group, a };
    wire(p);
    return p;
  });
  const mine = parts;
  await Promise.all(parts.map(({ a }) => ready(a)));
  if (parts !== mine) return;  // another set was started meanwhile
  const lead = parts[0].a;
  lead.addEventListener("ended", () => { if (parts === mine) { pauseStems(); seekStems(0); } });
  applyGains();
  await playAll();
  if (parts !== mine) return;
  if (lead.paused) { set({ loading: false, error: "Couldn't play these stems" }); teardown(); return; }
  set({ loading: false, playing: true, duration: lead.duration || 0 });
}

// Get a set ready to mix without playing it, so faders, mutes and solos can be set
// before pressing play.
export function armStems(setId: string) {
  if (mix.setId === setId) return;
  teardown();
  set({ ...EMPTY, setId });
}

export function pauseStems() {
  window.clearInterval(timer);
  for (const { a } of parts) a.pause();
  set({ playing: false });
}

export function stopStems() {
  if (!mix.setId) return;
  teardown();
  set(EMPTY);
}

export function seekStems(fraction: number) {
  const d = parts[0]?.a.duration;
  if (!d) return;
  for (const { a } of parts) a.currentTime = fraction * d;
  set({ time: fraction * d });
}

const flip = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
export function toggleMute(path: string) { set({ muted: flip(mix.muted, path) }); applyGains(); }
export function toggleSolo(path: string) { set({ soloed: flip(mix.soloed, path) }); applyGains(); }
export function toggleGroupMute(g: string) { set({ groupMuted: flip(mix.groupMuted, g) }); applyGains(); }
export function toggleGroupSolo(g: string) { set({ groupSoloed: flip(mix.groupSoloed, g) }); applyGains(); }
export function setFader(path: string, v: number) { set({ faders: { ...mix.faders, [path]: v } }); applyGains(); }
export function setGroupFader(g: string, v: number) { set({ groupFaders: { ...mix.groupFaders, [g]: v } }); applyGains(); }
// Every fader back to 0 dB, nothing muted or soloed.
export function resetMix() {
  set({ muted: [], soloed: [], groupMuted: [], groupSoloed: [], faders: {}, groupFaders: {} });
  applyGains();
}
// A part moved to another group while playing follows its new group's controls.
export function regroup(path: string, group: string) {
  const p = parts.find((x) => x.path === path);
  if (p) { p.group = group; applyGains(); }
}

// Each part's level right now (0..1, the loudest sample of the last few milliseconds).
export function levels(): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of parts) {
    if (!p.level || p.a.paused) { out.set(p.path, 0); continue; }
    p.level.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; }
    out.set(p.path, peak);
  }
  return out;
}

export function useStemMix(): Mix {
  const [m, setM] = useState<Mix>(mix);
  useEffect(() => { subs.add(setM); return () => { subs.delete(setM); }; }, []);
  return m;
}
