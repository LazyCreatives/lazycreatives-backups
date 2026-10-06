import type { Project } from "./types";
import { genreOf } from "./types";

// "More like this": rank the library against one record. Tempo, genre and key come
// from the projects; how a song sounds (loud, bright, heavy low end, punchy) comes
// from listening to its newest exported song here on the computer.

export interface SoundPrint {
  loud: number;   // average level, dB below full scale (0 = flat out, -30 = quiet)
  bright: number; // how often the wave crosses zero, a stand-in for treble (0..1)
  low: number;    // share of the energy under about 150 Hz (0..1)
  punch: number;  // peak over average, dB (high = punchy drums, low = squashed)
}

// Listen to up to 40 seconds from the middle of the song, every 4th sample at 44.1k.
export function soundPrint(ch: Float32Array, sampleRate: number): SoundPrint | null {
  const want = Math.floor(sampleRate * 40);
  const start = Math.max(0, Math.floor((ch.length - want) / 2));
  const end = Math.min(ch.length, start + want);
  const step = Math.max(1, Math.round(sampleRate / 11025));
  // one-pole low-pass at ~150 Hz, run on the thinned-out samples
  const a = 1 - Math.exp((-2 * Math.PI * 150 * step) / sampleRate);
  let lp = 0, sum = 0, lowSum = 0, peak = 0, cross = 0, n = 0, prev = 0;
  for (let i = start; i < end; i += step) {
    const x = ch[i];
    lp += a * (x - lp);
    sum += x * x; lowSum += lp * lp;
    const ax = Math.abs(x); if (ax > peak) peak = ax;
    if ((x >= 0) !== (prev >= 0)) cross++;
    prev = x; n++;
  }
  if (n < 100 || sum === 0) return null;
  const rms = Math.sqrt(sum / n);
  const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-6));
  return {
    loud: db(rms),
    bright: cross / n,
    low: Math.min(1, lowSum / sum),
    punch: db(peak) - db(rms),
  };
}

export interface Match { project: Project; score: number; why: string[] }

// Tempos match at half or double time too (a 70 BPM and a 140 BPM track sit together).
export function tempoGap(a: number, b: number): number {
  return Math.min(...[a, a * 2, a / 2].map((x) => Math.abs(x - b) / b));
}

const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
// "F minor" / "Fm" / "A# major" → pitch 0..11 and minor flag, or null.
export function parseKey(k: string | null | undefined): { pc: number; minor: boolean } | null {
  const m = /^\s*([A-Ga-g])([#b]?)\s*(m(?:in(?:or)?)?|maj(?:or)?)?\s*$/i.exec(k ?? "");
  if (!m) return null;
  let note = m[1].toUpperCase() + (m[2] ?? "");
  note = FLATS[note] ?? note;
  const pc = KEY_NAMES.indexOf(note);
  if (pc < 0) return null;
  return { pc, minor: !!m[3] && /^m(?!aj)/i.test(m[3]) };
}

// Same key, or next door on the circle of fifths / its relative major or minor.
function keyFit(a: string | null, b: string | null): "same" | "related" | null {
  const x = parseKey(a), y = parseKey(b);
  if (!x || !y) return null;
  const rel = (k: { pc: number; minor: boolean }) => k.minor ? k.pc : (k.pc + 9) % 12; // compare as minors
  const d = (rel(x) - rel(y) + 12) % 12;
  if (d === 0) return x.minor === y.minor ? "same" : "related";
  return d === 5 || d === 7 ? "related" : null;
}

// Score one record against the seed, 0..100, with the plain reasons it matches.
export function compare(seed: Project, other: Project, sp?: SoundPrint | null, op?: SoundPrint | null): Match {
  let got = 0, max = 0;
  const why: string[] = [];
  // A factor counts whenever the seed has it; a record missing it gets a little credit.
  if (seed.bpm) max += 35;
  if (seed.bpm && !other.bpm) got += 10;
  if (seed.bpm && other.bpm) {
    const gap = tempoGap(seed.bpm, other.bpm);
    got += 35 * Math.max(0, 1 - gap / 0.12);
    if (gap < 0.01) why.push("Same tempo"); else if (gap < 0.05) why.push("Close tempo");
  }
  const g1 = genreOf(seed), g2 = genreOf(other);
  if (g1) {
    max += 20;
    if (g1 === g2) { got += 20; why.push("Same genre"); }
  }
  const k = keyFit(seed.musicalKey, other.musicalKey);
  if (seed.musicalKey && other.musicalKey) {
    max += 15;
    if (k === "same") { got += 15; why.push("Same key"); } else if (k === "related") { got += 9; why.push("Related key"); }
  }
  if (sp) max += 30;
  if (sp && !op) got += 10;
  if (sp && op) {
    const loud = Math.max(0, 1 - Math.abs(sp.loud - op.loud) / 8);
    const bright = Math.max(0, 1 - Math.abs(sp.bright - op.bright) / 0.08);
    const low = Math.max(0, 1 - Math.abs(sp.low - op.low) / 0.3);
    const punch = Math.max(0, 1 - Math.abs(sp.punch - op.punch) / 6);
    got += 9 * loud + 8 * bright + 8 * low + 5 * punch;
    if (loud > 0.75) why.push("As loud");
    if (low > 0.75 && op.low > 0.35) why.push("Deep bass");
    if (bright > 0.75) why.push(op.bright > 0.12 ? "Bright" : "Same tone");
  }
  return { project: other, score: max ? Math.round((got / max) * 100) : 0, why: why.slice(0, 3) };
}

// The library ranked against the seed: only records with a song or a tempo to go on.
export function moreLikeThis(seed: Project, all: Project[], prints: Map<string, SoundPrint | null>, limit = 12): Match[] {
  const sp = seed.latest ? prints.get(seed.latest.path) : null;
  return all
    .filter((p) => p.id !== seed.id && (p.bpm || p.latest))
    .map((p) => compare(seed, p, sp, p.latest ? prints.get(p.latest.path) : null))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name))
    .slice(0, limit);
}
