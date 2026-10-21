import { useEffect, useState } from "react";
import { toast, toastWarn } from "../components/Desktop";
import { makeApi } from "../api";
import type { ExportRow, StemGroup, StemSet } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { usePlayerState } from "../components/Player";
import { fmtDay, fmtSize } from "../format";
import { playStems, stopStems, useStemMix } from "../stemMixer";

const api = makeApi();
const bridge = () => (window as any).ablebackup;
export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const fmtWhen = (secs: number) => fmtDay(secs * 1000, { time: true });

// Zip one stem set (stems in a folder per group, the song, the instrumental and a
// BPM and key sheet) into a new file in a folder the producer picks.
export async function makeStemPack(projectId: string, s: StemSet): Promise<void> {
  const target: string | null = await bridge()?.pickFolder?.();
  if (!target) return;
  try {
    const { job_id } = await api.stemPack(projectId, s.id, target);
    let res = await api.jobStatus(job_id);
    for (let i = 0; i < 2400 && res.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 500));
      res = await api.jobStatus(job_id);
    }
    if (res.state === "done" && res.result?.path) {
      const path: string = res.result.path;
      toast(`Stem pack saved: ${path.split(/[\\/]/).pop()}`, { label: "Show", onClick: () => bridge()?.revealPath?.(path) });
    } else if (res.state === "error") toastWarn(`Couldn't make the stem pack: ${res.error}`);
    else toast("Still making the stem pack. It will be in the folder you picked in a minute or two.");
  } catch (e: any) {
    toastWarn(`Couldn't make the stem pack: ${e?.message ?? e}`);
  }
}

// How many parts are in each group, in the desk's order: "Drums 24 · Bass 6".
export function groupCounts(s: StemSet, groups: StemGroup[]): { id: string; name: string; n: number }[] {
  return groups.map((g) => ({ ...g, n: s.parts.filter((p) => p.group === g.id).length })).filter((g) => g.n > 0);
}

// A project's stems, one row per set (the parts exported together): play them all
// together, see whether they line up and how they're grouped, open the desk, or make
// a stem pack. The rows sit in the songs table, in the same columns as the songs above.
export function StemSets({ projectId, rows, cols, onOpen }: {
  projectId: string; rows: ExportRow[]; cols: string; onOpen?: (setId: string) => void;
}) {
  const [data, setData] = useState<{ sets: StemSet[]; groups: StemGroup[] } | null>(null);
  const [packing, setPacking] = useState<string | null>(null);
  const mix = useStemMix();
  const player = usePlayerState();
  const sig = rows.map((r) => `${r.path}:${r.mtime}`).join("|");

  useEffect(() => {
    api.stemSets(projectId).then((r) => setData({ sets: r.sets, groups: r.groups })).catch(() => setData({ sets: [], groups: [] }));
  }, [projectId, sig]);
  // the main player taking over stops the stems
  useEffect(() => { if (player.playing) stopStems(); }, [player.playing]);

  if (data === null) return <div className={`${cols} stemset-wait`}><span /><span className="faint">Reading the stems…</span></div>;

  return <>
    {data.sets.map((s) => {
      const live = mix.setId === s.id;
      const c = s.check;
      const quality = [c.rate ? `${c.rate / 1000} kHz` : "", c.bits ? `${c.bits}-bit` : ""].filter(Boolean).join(", ");
      return (
        <div key={s.id} className={`${cols} stemset-head`}>
          <button type="button" className={`playbtn${live && (mix.playing || mix.loading) ? " playbtn--on" : ""}`}
            style={{ width: 30, height: 30 }}
            aria-label={live && mix.playing ? "Pause the stems" : `Play all ${s.parts.length} parts together`}
            title={live && mix.playing ? "Pause" : "Play every part together"}
            onClick={() => playStems(s.id, s.parts.map((p) => ({ path: p.path, group: p.group })))}>
            <Icon name={live && mix.playing ? "pause" : "play"} size={12} />
          </button>
          <div className="stemset-info">
            <button type="button" className="stemset-title" onClick={() => onOpen?.(s.id)}
              title="Open the stems on a mixing desk">
              <span>Stem set · {s.parts.length} part{s.parts.length === 1 ? "" : "s"}</span>
              <Icon name="chevronRight" size={14} />
            </button>
            <span className="sub stemset-when">{fmtWhen(s.when)} · {fmtSize(s.size)}</span>
            <div className="stemset-groups faint">
              {groupCounts(s, data.groups).map((g) => (
                <span key={g.id} className={`stemset-group stem-g--${g.id}`}>{g.name} {g.n}</span>
              ))}
            </div>
            <div className="stemset-sub">
              {c.ok
                ? <span className="pill pill--ok" title={quality ? `Same length and quality: ${quality}` : "Same length"}>In sync</span>
                : <span className="pill pill--partial" title={c.problems.join("\n")}>Check these</span>}
              {live && (mix.playing || mix.loading || mix.time > 0) && (mix.loading
                ? <span className="faint">Loading…</span>
                : <span className="mono faint stemset-clock">{clock(mix.time)} / {clock(mix.duration)}</span>)}
              <Button size="sm" onClick={() => onOpen?.(s.id)}>Open stems</Button>
              <Button size="sm" variant="ghost" disabled={packing !== null}
                onClick={async () => { setPacking(s.id); await makeStemPack(projectId, s); setPacking(null); }}
                title={`Zip these stems${s.master ? ", the song" : ""}${s.instrumental ? ", the instrumental" : ""} and a sheet with the BPM and key into a new file. Your files stay as they are.`}>
                {packing === s.id ? "Packing…" : "Make stem pack"}
              </Button>
            </div>
            {!c.ok && <ul className="stemset-problems">{c.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            {live && mix.error && <div className="stemset-problems">{mix.error}</div>}
          </div>
          <div className="song-actions">
            <button className="iconbtn" title="Show the folder" aria-label="Show the stems folder"
              onClick={() => bridge()?.revealPath?.(s.parts[0]?.path)}><Icon name="folder" /></button>
          </div>
        </div>
      );
    })}
  </>;
}
