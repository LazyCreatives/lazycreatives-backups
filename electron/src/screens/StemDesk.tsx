import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { glideAcross } from "../glide";
import { openMenu, toast, toastWarn } from "../components/Desktop";
import { copyText, keep, recall } from "../desktop";
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
import { stemLabels, withoutExt } from "../stemNames";

const api = makeApi();
const bridge = () => (window as any).ablebackup;
const DRAG = "text/x-lc-stem";

// A project's stems on a mixing desk: one channel strip per stem, sorted into groups
// (Drums, Bass, Vocals, Keys and synths, FX, Other), each group with its own strip.
// Every strip has a level meter, a fader, mute and solo. Drag a stem onto another
// group to move it; Backups remembers. Made for sets of a hundred stems or more:
// each group is a row of its own (scrolling sideways when it's long), a group folds
// shut to one line with its mute and solo, and the list of groups at the top jumps
// to one. Which groups are folded is remembered.
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
  const [folded, setFoldedState] = useState<string[]>(() => recall("lc-desk-folded", [] as string[], Array.isArray));
  const setFolded = (f: (now: string[]) => string[]) => setFoldedState((now) => { const n = f(now); keep("lc-desk-folded", n); return n; });
  const fold = (id: string, shut: boolean) => setFolded((now) => (shut ? [...new Set([...now, id])] : now.filter((g) => g !== id)));
  function jump(id: string) {
    fold(id, false);
    // a smooth glide, or straight there when the computer asks for less motion (a JS scroll isn't covered by the CSS guard)
    const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    requestAnimationFrame(() => desk.current?.querySelector(`[data-group="${id}"]`)?.scrollIntoView({ block: "start", behavior }));
  }

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
  // each strip's short name: the words every stem in the set shares are left off
  const labels = useMemo(() => {
    const parts = set?.parts ?? [];
    const short = stemLabels(parts);
    return new Map(parts.map((p, i) => [p.path, short[i]]));
  }, [set]);
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

  // A moved stem glides from its old group to its new one (when the new group is open).
  const glideFrom = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const from = glideFrom.current;
    if (!from || !desk.current) return;
    glideFrom.current = null;
    from.forEach((r, path) => {
      const el = desk.current!.querySelector<HTMLElement>(`[data-strip="${CSS.escape(path)}"]`);
      if (!el) return;
      // it lands out of sight in a long row: no glide to a place you can't see
      const row = el.closest(".desk-strips")?.getBoundingClientRect(), at = el.getBoundingClientRect();
      if (row && (at.left < row.left - 1 || at.right > row.right + 1)) return;
      glideAcross(el, r, desk.current!);
    });
  }, [data, folded]);

  async function move(paths: string[], to: string, undo = true) {
    if (!set || !data) return;
    const before = new Map(set.parts.map((p) => [p.path, p]));
    const moved = paths.filter((p) => before.get(p) && before.get(p)!.group !== to);
    if (!moved.length) return;
    const from = new Map<string, DOMRect>();
    moved.forEach((p) => {
      const el = desk.current?.querySelector<HTMLElement>(`[data-strip="${CSS.escape(p)}"]`);
      if (el) from.set(p, el.getBoundingClientRect());
    });
    glideFrom.current = from.size ? from : null;
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
          ? <span className="pill pill--ok" title="Every stem is the same length and starts at the same time, so they play together">All stems in sync</span>
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
      {(() => {
        const used = groups.filter((g) => g.parts.length > 0);
        const allShut = used.length > 0 && used.every((g) => folded.includes(g.id));
        return (
          <div className="desk-jump">
            <nav className="desk-jump__groups" aria-label="Go to a group">
              {used.map((g) => (
                <button key={g.id} type="button" className={`desk-jump__g stem-g--${g.id}`} onClick={() => jump(g.id)}
                  title={`Go to ${g.name}`}>
                  {g.name} <span className="mono">{g.parts.length}</span>
                </button>
              ))}
            </nav>
            <Button size="sm" variant="ghost" onClick={() => setFolded(() => (allShut ? [] : used.map((g) => g.id)))}>
              {allShut ? "Open every group" : "Fold every group"}</Button>
          </div>
        );
      })()}
      <p className="faint desk-hint">Sorted by name. Drag a stem onto another group to move it, right-click it, or press Alt and the up or down arrow. Backups remembers.</p>

      <div className={`desk${dragging ? " desk--dragging" : ""}`} ref={desk} role="region" aria-label="Mixing desk">
        {groups.filter((g) => g.parts.length > 0 || dragging).map((g) => {
          const shut = folded.includes(g.id) && g.parts.length > 0;
          return (
          <section key={g.id} data-group={g.id}
            className={`desk-group stem-g--${g.id}${over === g.id ? " desk-group--over" : ""}${shut ? " desk-group--shut" : ""}`}
            aria-label={`${g.name}, ${g.parts.length} stem${g.parts.length === 1 ? "" : "s"}`}
            onDragOver={(e) => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(g.id); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === g.id ? null : o)); }}
            onDrop={(e) => onDrop(e, g.id)}>
            <header className="desk-group__name">
              <button type="button" className="desk-group__fold" aria-expanded={!shut} disabled={g.parts.length === 0}
                title={shut ? `Open ${g.name}` : `Fold ${g.name} shut`} onClick={() => fold(g.id, !shut)}>
                <Icon name={shut ? "chevronRight" : "chevronDown"} size={14} />
                <span>{g.name}</span><span className="mono">{g.parts.length}</span>
              </button>
              {shut && <GroupMs id={g.id} name={g.name} mix={mix} live={live} arm={arm} />}
            </header>
            {!shut && (
              <div className="desk-strips" tabIndex={0} role="group" aria-label={`${g.name} strips`}>
                {g.parts.length === 0
                  ? <div className="desk-drop faint">Drop here</div>
                  : <>
                    <GroupStrip id={g.id} name={g.name} mix={mix} live={live} arm={arm} />
                    {g.parts.map((p) => (
                      <Strip key={p.path} p={p} label={labels.get(p.path) ?? p.part} mix={mix} live={live} arm={arm} groups={data.groups}
                        onDrag={(on) => { setDragging(on ? p.path : null); if (!on) setOver(null); }}
                        onMove={(to) => move([p.path], to)}
                        onStep={(dir) => {
                          // Alt + up/down: the group before or after this one (opened if folded), then keep focus on the same control
                          const i = data.groups.findIndex((x) => x.id === p.group);
                          const to = data.groups[i + dir];
                          if (!to) return;
                          const cls = (document.activeElement as HTMLElement | null)?.className.split(" ")[0];
                          fold(to.id, false);
                          void move([p.path], to.id);
                          requestAnimationFrame(() => desk.current?.querySelector<HTMLElement>(
                            `[data-strip="${CSS.escape(p.path)}"] ${cls ? "." + cls : ""}`)?.focus());
                        }} />
                    ))}
                  </>}
              </div>
            )}
          </section>
          );
        })}
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

// A folded group's own mute and solo, on its one line
function GroupMs({ id, name, mix, live, arm }: { id: string; name: string; mix: Mix; live: boolean; arm: () => void }) {
  const muted = live && mix.groupMuted.includes(id);
  const soloed = live && mix.groupSoloed.includes(id);
  const v = live ? mix.groupFaders[id] ?? 1 : 1;
  return (
    <div className="strip__ms desk-group__ms">
      <span className="mono desk-group__db">{faderDb(v)} dB</span>
      <button type="button" className={`msbtn${muted ? " msbtn--on" : ""}`} aria-pressed={muted}
        aria-label={`Mute all ${name}`} title={`Mute all ${name}`} onClick={() => { arm(); toggleGroupMute(id); }}>M</button>
      <button type="button" className={`msbtn msbtn--solo${soloed ? " msbtn--on" : ""}`} aria-pressed={soloed}
        aria-label={`Solo all ${name}`} title={`Hear only ${name}`} onClick={() => { arm(); toggleGroupSolo(id); }}>S</button>
    </div>
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
      <div className="strip__db mono">{faderDb(v)} dB</div>
      <div className="strip__ms">
        <button type="button" className={`msbtn${muted ? " msbtn--on" : ""}`} aria-pressed={muted}
          aria-label={`Mute all ${name}`} title={`Mute all ${name}`} onClick={() => { arm(); toggleGroupMute(id); }}>M</button>
        <button type="button" className={`msbtn msbtn--solo${soloed ? " msbtn--on" : ""}`} aria-pressed={soloed}
          aria-label={`Solo all ${name}`} title={`Hear only ${name}`} onClick={() => { arm(); toggleGroupSolo(id); }}>S</button>
      </div>
    </div>
  );
}

function Strip({ p, label, mix, live, arm, groups, onDrag, onMove, onStep }: {
  p: StemPart; label: string; mix: Mix; live: boolean; arm: () => void; groups: StemGroup[];
  onDrag: (on: boolean) => void; onMove: (to: string) => void; onStep: (dir: -1 | 1) => void;
}) {
  const v = live ? mix.faders[p.path] ?? 1 : 1;
  const muted = live && mix.muted.includes(p.path);
  const soloed = live && mix.soloed.includes(p.path);
  const heard = !live || partHeard(p.path, p.group, mix);
  const full = withoutExt(p.name);
  return (
    <div className={`strip${heard ? "" : " strip--off"}`} draggable data-strip={p.path}
      role="group" aria-label={`${full}. Alt and up or down arrow moves it to another group`}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault(); e.stopPropagation();
        onStep(e.key === "ArrowUp" ? -1 : 1);
      }}
      title={`${full}${p.seconds != null ? ` · ${clock(p.seconds)}` : ""}`}
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
      <StripName label={label} />
      <div className="strip__body">
        <div className="strip__meter"><i data-meter={p.path} /></div>
        <Fader value={v} label={`${label} volume`} onChange={(x) => { arm(); setFader(p.path, x); }} />
      </div>
      <div className="strip__db mono">{faderDb(v)} dB</div>
      <div className="strip__ms">
        <button type="button" className={`msbtn${muted ? " msbtn--on" : ""}`} aria-pressed={muted}
          aria-label={`Mute ${label}`} title="Mute" onClick={() => { arm(); toggleMute(p.path); }}>M</button>
        <button type="button" className={`msbtn msbtn--solo${soloed ? " msbtn--on" : ""}`} aria-pressed={soloed}
          aria-label={`Solo ${label}`} title="Solo" onClick={() => { arm(); toggleSolo(p.path); }}>S</button>
      </div>
    </div>
  );
}

// A strip's name on one line. When it is too long the "…" goes before its last word,
// as long as that word is short ("Vox C… 091"): that's usually the number or take that
// tells the stems apart. The full name is in the strip's tooltip.
function StripName({ label }: { label: string }) {
  const cut = label.lastIndexOf(" ");
  const last = cut > 0 ? label.slice(cut + 1) : "";
  if (!last || last.length > 5) return <div className="strip__name" lang="en"><span className="strip__name-a">{label}</span></div>;
  return (
    <div className="strip__name" lang="en">
      <span className="strip__name-a">{label.slice(0, cut)}</span>&nbsp;<span className="strip__name-b">{last}</span>
    </div>
  );
}
