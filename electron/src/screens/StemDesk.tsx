import { useEffect, useMemo, useRef, useState } from "react";
import { openMenu, toast, toastWarn } from "../components/Desktop";
import { copyText } from "../desktop";
import { makeApi } from "../api";
import type { StemGroup, StemPart, StemSet } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { usePlayerState } from "../components/Player";
import { fmtDay } from "../format";
import {
  armStems, faderDb, levels, partHeard, playStems, regroup, resetMix, seekStems, setFader, setGroupFader, stopStems,
  toggleGroupMute, toggleGroupSolo, toggleMute, toggleSolo, useStemMix, type Mix,
} from "../stemMixer";
import { clock, makeStemPack } from "./StemSets";

const api = makeApi();
const bridge = () => (window as any).ablebackup;
const DRAG = "text/x-lc-stem";

// A project's stems on a mixing desk: one channel strip per stem, sorted into groups
// (Drums, Bass, Vocals, Keys and synths, FX, Other), each group with its own strip.
// Every strip has a level meter, a fader, mute and solo. Drag a stem onto another
// group to move it; Backups remembers. Made for sets of a hundred stems or more:
// the desk scrolls sideways and each strip stays narrow.
export function StemDesk({ projectId, projectName, setId, onBack }: {
  projectId: string; projectName: string; setId: string | null; onBack: () => void;
}) {
  const [data, setData] = useState<{ sets: StemSet[]; groups: StemGroup[] } | null>(null);
  const [pick, setPick] = useState<string | null>(setId);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [packing, setPacking] = useState(false);
  const mix = useStemMix();
  const player = usePlayerState();
  const desk = useRef<HTMLDivElement>(null);

  function load() {
    api.stemSets(projectId).then((r) => setData({ sets: r.sets, groups: r.groups }))
      .catch(() => setData({ sets: [], groups: [] }));
  }
  useEffect(load, [projectId]);
  useEffect(() => { if (player.playing) stopStems(); }, [player.playing]);

  const set = data?.sets.find((s) => s.id === pick) ?? data?.sets[0] ?? null;
  const groups = useMemo(() => (data?.groups ?? []).map((g) => ({
    ...g, parts: (set?.parts ?? []).filter((p) => p.group === g.id),
  })), [data, set]);
  const live = !!set && mix.setId === set.id;
  const arm = () => { if (set) armStems(set.id); };

  // Meters: read every part's level each frame and draw it straight onto its bar.
  useEffect(() => {
    if (!live || !mix.playing) return;
    const shown = new Map<string, number>();
    let raf = 0;
    const tick = () => {
      const lv = levels();
      const root = desk.current;
      if (root) {
        const groupPeak = new Map<string, number>();
        for (const p of set!.parts) {
          const v = Math.max(lv.get(p.path) ?? 0, (shown.get(p.path) ?? 0) * 0.86);
          shown.set(p.path, v);
          groupPeak.set(p.group, Math.max(groupPeak.get(p.group) ?? 0, v));
        }
        root.querySelectorAll<HTMLElement>("[data-meter]").forEach((el) => {
          const key = el.dataset.meter!;
          const v = key.startsWith("group:") ? groupPeak.get(key.slice(6)) ?? 0 : shown.get(key) ?? 0;
          const db = v > 0 ? 20 * Math.log10(v) : -60;
          el.style.transform = `scaleY(${Math.max(0, Math.min(1, (db + 60) / 60))})`;
          el.classList.toggle("meter--hot", db > -1);
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      desk.current?.querySelectorAll<HTMLElement>("[data-meter]").forEach((el) => { el.style.transform = "scaleY(0)"; });
    };
  }, [live, mix.playing, set]);

  async function move(paths: string[], to: string, undo = true) {
    if (!set || !data) return;
    const before = new Map(set.parts.map((p) => [p.path, p]));
    const moved = paths.filter((p) => before.get(p) && before.get(p)!.group !== to);
    if (!moved.length) return;
    const parts = set.parts.map((p) => moved.includes(p.path) ? { ...p, group: to } : p);
    setData({ ...data, sets: data.sets.map((s) => s.id === set.id ? { ...s, parts } : s) });
    moved.forEach((p) => regroup(p, to));
    try {
      // back where it was sorted by itself: forget the move instead of keeping it
      const auto = before.get(moved[0])!.auto_group;
      await api.moveStems(moved, moved.length === 1 && auto === to ? null : to);
      if (undo) {
        const first = before.get(moved[0])!;
        const toName = data.groups.find((g) => g.id === to)?.name ?? to;
        toast(`Moved ${first.part} to ${toName}.`, { label: "Undo", onClick: () => move(moved, first.group, false) });
      }
    } catch (e: any) {
      toastWarn(`Couldn't move it: ${e?.message ?? e}`);
      load();
    }
  }

  function onDrop(e: React.DragEvent, to: string) {
    e.preventDefault();
    const path = e.dataTransfer.getData(DRAG);
    setDragging(null); setOver(null);
    if (path) move([path], to);
  }

  const back = <button className="lib-back" onClick={() => { stopStems(); onBack(); }}><Icon name="arrowLeft" size={14} />{projectName}</button>;
  if (data === null) return <>{back}<div className="empty">Reading the stems…</div></>;
  if (!set) return <>{back}<div className="empty">No stems found for this project.</div></>;

  const c = set.check;
  const facts = [
    `Exported ${fmtDay(set.when * 1000, { time: true })}`,
    `${set.parts.length} part${set.parts.length === 1 ? "" : "s"}`,
    c.seconds ? clock(c.seconds) : "",
    [c.rate ? `${c.rate / 1000} kHz` : "", c.bits ? `${c.bits}-bit` : ""].filter(Boolean).join(", "),
  ].filter(Boolean);
  const play = () => playStems(set.id, set.parts.map((p) => ({ path: p.path, group: p.group })));

  return (
    <div className="stemdesk">
      {back}
      <header className="desk-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="desk-title">Stems</h2>
          <p className="sub desk-facts">{facts.join(" · ")}</p>
        </div>
        {data.sets.length > 1 && (
          <div className="desk-sets" role="group" aria-label="Stem set">
            {data.sets.map((s) => (
              <button key={s.id} type="button" className="desk-set" aria-pressed={s.id === set.id}
                onClick={() => { if (s.id !== set.id) { stopStems(); setPick(s.id); } }}>
                {fmtDay(s.when * 1000)} · {s.parts.length}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="desk-transport">
        <button type="button" className={`playbtn desk-play${live && (mix.playing || mix.loading) ? " playbtn--on" : ""}`}
          aria-label={live && mix.playing ? "Pause" : `Play all ${set.parts.length} parts together`} onClick={play}>
          <Icon name={live && mix.playing ? "pause" : "play"} size={16} />
        </button>
        <span className="mono desk-clock">{live && mix.loading ? "Loading…" : `${clock(live ? mix.time : 0)} / ${clock(live && mix.duration ? mix.duration : c.seconds ?? 0)}`}</span>
        <input type="range" className="desk-seek" min={0} max={1000} aria-label="Where in the stems" disabled={!live || !mix.duration}
          value={live && mix.duration ? Math.round((mix.time / mix.duration) * 1000) : 0}
          onChange={(e) => seekStems(Number(e.target.value) / 1000)} />
        {c.ok
          ? <span className="pill pill--ok">Lines up</span>
          : <span className="pill pill--partial" title={c.problems.join("\n")}>Check these</span>}
        <Button size="sm" variant="ghost" onClick={resetMix} disabled={!live}
          title="Every fader back to 0 dB, nothing muted or soloed">Reset mix</Button>
        <Button size="sm" disabled={packing} onClick={async () => { setPacking(true); await makeStemPack(projectId, set); setPacking(false); }}
          title="Zip the stems (a folder per group), the song, the instrumental and a sheet with the BPM and key into a new file">
          {packing ? "Packing…" : "Make stem pack"}</Button>
        <button className="iconbtn" title="Show the folder" aria-label="Show the stems folder"
          onClick={() => bridge()?.revealPath?.(set.parts[0]?.path)}><Icon name="folder" /></button>
      </div>
      {!c.ok && <ul className="stemset-problems">{c.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {live && mix.error && <div className="stemset-problems">{mix.error}</div>}
      <p className="faint desk-hint">Sorted by name. Drag a stem onto another group to move it, or right-click it. Backups remembers.</p>

      <div className={`desk${dragging ? " desk--dragging" : ""}`} ref={desk} role="region" aria-label="Mixing desk" tabIndex={0}>
        {groups.filter((g) => g.parts.length > 0 || dragging).map((g) => (
          <section key={g.id} className={`desk-group stem-g--${g.id}${over === g.id ? " desk-group--over" : ""}`}
            aria-label={`${g.name}, ${g.parts.length} stem${g.parts.length === 1 ? "" : "s"}`}
            onDragOver={(e) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(g.id); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === g.id ? null : o)); }}
            onDrop={(e) => onDrop(e, g.id)}>
            <header className="desk-group__name"><span>{g.name}</span><span className="mono">{g.parts.length}</span></header>
            <div className="desk-strips">
              {g.parts.length === 0
                ? <div className="desk-drop faint">Drop here</div>
                : <>
                  <GroupStrip id={g.id} name={g.name} mix={mix} live={live} arm={arm} />
                  {g.parts.map((p) => (
                    <Strip key={p.path} p={p} mix={mix} live={live} arm={arm} groups={data.groups}
                      onDrag={(on) => { setDragging(on ? p.path : null); if (!on) setOver(null); }}
                      onMove={(to) => move([p.path], to)} />
                  ))}
                </>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Fader({ value, label, onChange }: { value: number; label: string; onChange: (v: number) => void }) {
  return (
    <input type="range" className="strip__fader" min={0} max={1} step={0.01} value={value}
      aria-label={label} aria-valuetext={`${faderDb(value)} dB`} title={`${faderDb(value)} dB · double-click for 0 dB`}
      onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(1)} />
  );
}

function GroupStrip({ id, name, mix, live, arm }: { id: string; name: string; mix: Mix; live: boolean; arm: () => void }) {
  const v = live ? mix.groupFaders[id] ?? 1 : 1;
  const muted = live && mix.groupMuted.includes(id);
  const soloed = live && mix.groupSoloed.includes(id);
  return (
    <div className="strip strip--bus" title={`Every ${name.toLowerCase()} stem at once`}>
      <div className="strip__cap" />
      <div className="strip__name">All</div>
      <div className="strip__body">
        <div className="strip__meter"><i data-meter={`group:${id}`} /></div>
        <Fader value={v} label={`All ${name} volume`} onChange={(x) => { arm(); setGroupFader(id, x); }} />
      </div>
      <div className="strip__db mono">{faderDb(v)}</div>
      <div className="strip__ms">
        <button type="button" className={`msbtn${muted ? " msbtn--on" : ""}`} aria-pressed={muted}
          aria-label={`Mute all ${name}`} title={`Mute all ${name}`} onClick={() => { arm(); toggleGroupMute(id); }}>M</button>
        <button type="button" className={`msbtn msbtn--solo${soloed ? " msbtn--on" : ""}`} aria-pressed={soloed}
          aria-label={`Solo all ${name}`} title={`Hear only ${name}`} onClick={() => { arm(); toggleGroupSolo(id); }}>S</button>
      </div>
    </div>
  );
}

function Strip({ p, mix, live, arm, groups, onDrag, onMove }: {
  p: StemPart; mix: Mix; live: boolean; arm: () => void; groups: StemGroup[];
  onDrag: (on: boolean) => void; onMove: (to: string) => void;
}) {
  const v = live ? mix.faders[p.path] ?? 1 : 1;
  const muted = live && mix.muted.includes(p.path);
  const soloed = live && mix.soloed.includes(p.path);
  const heard = !live || partHeard(p.path, p.group, mix);
  return (
    <div className={`strip${heard ? "" : " strip--off"}`} draggable
      title={`${p.part}\n${p.name}${p.seconds != null ? ` · ${clock(p.seconds)}` : ""}`}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG, p.path); e.dataTransfer.effectAllowed = "move"; onDrag(true); }}
      onDragEnd={() => onDrag(false)}
      onContextMenu={(e) => openMenu(e, [
        ...groups.filter((g) => g.id !== p.group).map((g) => ({ label: `Move to ${g.name}`, onClick: () => onMove(g.id) })),
        ...(p.group !== p.auto_group ? [{ label: "Back to where it was sorted", onClick: () => onMove(p.auto_group) }] : []),
        "-" as const,
        { label: "Show the file", onClick: () => bridge()?.revealPath?.(p.path) },
        { label: "Copy file path", onClick: () => { copyText(p.path); } },
      ])}>
      <div className="strip__cap" />
      <div className="strip__name" lang="en">{p.part}</div>
      <div className="strip__body">
        <div className="strip__meter"><i data-meter={p.path} /></div>
        <Fader value={v} label={`${p.part} volume`} onChange={(x) => { arm(); setFader(p.path, x); }} />
      </div>
      <div className="strip__db mono">{faderDb(v)}</div>
      <div className="strip__ms">
        <button type="button" className={`msbtn${muted ? " msbtn--on" : ""}`} aria-pressed={muted}
          aria-label={`Mute ${p.part}`} title="Mute" onClick={() => { arm(); toggleMute(p.path); }}>M</button>
        <button type="button" className={`msbtn msbtn--solo${soloed ? " msbtn--on" : ""}`} aria-pressed={soloed}
          aria-label={`Solo ${p.part}`} title="Solo" onClick={() => { arm(); toggleSolo(p.path); }}>S</button>
      </div>
    </div>
  );
}
