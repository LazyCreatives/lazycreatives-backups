import { useEffect, useState } from "react";
import { makeApi } from "../../api";
import { soundPrint, type SoundPrint } from "./similar";

// Listens to exported songs for "More like this", one at a time, and remembers what it
// heard on this computer so each song is only listened to once.
const api = makeApi();
const STORE = "lc-sound-prints";
const prints = new Map<string, SoundPrint | null>(load());

function load(): [string, SoundPrint | null][] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || "{}");
    return v && typeof v === "object" ? Object.entries(v) : [];
  } catch { return []; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(prints))); } catch { /* full or blocked: keep in memory */ }
}

let queue: Promise<unknown> = Promise.resolve();
function listen(path: string): Promise<SoundPrint | null> {
  if (prints.has(path)) return Promise.resolve(prints.get(path)!);
  const run = queue.then(async () => {
    if (prints.has(path)) return prints.get(path)!;
    let out: SoundPrint | null = null;
    try {
      const buf = await (await fetch(api.exportAudioUrl(path))).arrayBuffer();
      const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
      out = soundPrint(audio.getChannelData(0), audio.sampleRate);
    } catch { out = null; }
    prints.set(path, out);
    return out;
  });
  queue = run.catch(() => null);
  return run;
}

// Listen to every song in `paths` (the seed first). Returns what has been heard so far,
// so the list can sharpen while it works.
export function useSoundPrints(paths: string[], on: boolean) {
  const [heard, setHeard] = useState(() => new Map(prints));
  const key = paths.join("\n");
  useEffect(() => {
    if (!on) return;
    let alive = true, dirty = 0;
    const todo = paths.filter((p) => !prints.has(p));
    if (!todo.length) { setHeard(new Map(prints)); return; }
    (async () => {
      for (const p of todo) {
        await listen(p);
        if (!alive) break;
        if (++dirty % 4 === 0 || p === todo[todo.length - 1]) setHeard(new Map(prints));
      }
      save();
    })();
    return () => { alive = false; save(); };
  }, [key, on]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = paths.filter((p) => heard.has(p)).length;
  return { prints: heard, done, total: paths.length };
}
