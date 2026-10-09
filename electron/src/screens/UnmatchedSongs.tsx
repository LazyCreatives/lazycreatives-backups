import { useEffect, useMemo, useState } from "react";
import { openMenu, toast } from "../components/Desktop";
import { copyText } from "../desktop";
import { makeApi } from "../api";
import type { LibraryItem, UnmatchedSong } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { PlayButton, SongWave } from "../components/Player";
import { ProjectPick, type Guess } from "../components/ProjectPick";
import { EmptyState } from "../components/SlothSpot";
import { fmtCount, fmtDay } from "../format";
import { extOf, groupSongs, type Group } from "../unmatched";

const api = makeApi();
const bridge = () => (window as any).ablebackup;

const fmtWhen = (secs: number | null) =>
  secs ? fmtDay(secs * 1000, { time: true }) : "";

const folderOf = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] ?? "";

// "Songs not matched yet": renders in your exports folders that Backups couldn't tie
// to a project. Each one can be played, linked to the suggested project (or one you
// pick) in one click, or put aside as "not a song". Linking teaches the matching too.
export function UnmatchedSongs({ items, onBack, onChanged }: {
  items: LibraryItem[]; onBack: () => void; onChanged?: () => void;
}) {
  const [songs, setSongs] = useState<UnmatchedSong[] | null>(null);
  const [aside, setAside] = useState<UnmatchedSong[]>([]);
  const [showAside, setShowAside] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api.unmatchedSongs().then((r) => setSongs(r.songs)).catch((e) => setErr(String(e.message ?? e)));
    api.unmatchedSongs(true).then((r) => setAside(r.songs)).catch(() => {});
  }
  useEffect(load, []);

  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.project_id, i])), [items]);
  const groups = useMemo(() => groupSongs((songs ?? []).filter((s) => s.kind !== "sample")), [songs]);
  const samples = useMemo(() => groupSongs((songs ?? []).filter((s) => s.kind === "sample")), [songs]);
  const asideGroups = useMemo(() => groupSongs(aside), [aside]);
  const target = (g: Group) => {
    const s = g.files.find((f) => f.suggest_id && byId[f.suggest_id]);
    return picked[g.key] ?? (s?.suggest_id ?? "");
  };
  const guessesOf = (g: Group): Guess[] => {
    const out: Guess[] = [];
    const seen = new Set<string>();
    for (const f of g.files) {
      if (f.suggest_id && !seen.has(f.suggest_id)) { seen.add(f.suggest_id); out.push({ project_id: f.suggest_id, why: f.suggest_why ?? "" }); }
    }
    for (const f of g.files) for (const x of f.guesses ?? []) {
      if (!seen.has(x.project_id)) { seen.add(x.project_id); out.push(x); }
    }
    return out.slice(0, 6);
  };

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key); setErr(null);
    try { await fn(); load(); onChanged?.(); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(null); }
  }
  const each = (g: Group, fn: (path: string) => Promise<unknown>) => () => Promise.all(g.files.map((f) => fn(f.path)));
  function link(g: Group) {
    const pid = target(g);
    if (!pid) return;
    run(g.key, each(g, (p) => api.linkExport(p, pid)));
    toast(`${g.name} is now with ${byId[pid]?.name ?? "that project"}.`,
      { label: "Undo", onClick: () => run(g.key, each(g, (p) => api.unlinkExport(p, pid))) });
  }
  function notASong(g: Group) {
    run(g.key, each(g, (p) => api.ignoreSong(p)));
    toast(`${g.name} won't be listed again.`, { label: "Undo", onClick: () => run(g.key, each(g, (p) => api.ignoreSong(p, false))) });
  }
  function allSamplesAside() {
    const files = samples.flatMap((g) => g.files);
    run("samples", () => Promise.all(files.map((f) => api.ignoreSong(f.path))));
    toast(samples.length === 1 ? "1 sample won't be listed again." : `${fmtCount(samples.length)} samples won't be listed again.`,
      { label: "Undo", onClick: () => run("samples", () => Promise.all(files.map((f) => api.ignoreSong(f.path, false)))) });
  }

  const row = (g: Group, setAsideRow = false) => {
    const s = g.main;
    const pid = target(g);
    const sug = g.files.find((f) => f.suggest_id === pid && byId[pid]);
    const exts = [...new Set(g.files.map((f) => extOf(f.path)).filter(Boolean))];
    const folders = [...new Set(g.files.map((f) => folderOf(f.path)))];
    return (
      <div key={g.key} className="row cols unm-cols" onContextMenu={(ev) => openMenu(ev, [
        ...(s.exists ? [{ label: "Show the file", onClick: () => bridge()?.revealPath?.(s.path) }] : []),
        { label: "Copy file path", onClick: () => { copyText(s.path); } },
      ])}>
        {s.exists ? <PlayButton path={s.path} title={s.name} meta={{ title: s.name }} /> : <span />}
        <div style={{ minWidth: 0 }}>
          <div className="song-name" title={g.files.map((f) => f.path).join("\n")}>{s.name}
            {s.kind === "stem" && <span className="unm-tag">stem</span>}
            {g.files.length > 1 && <span className="unm-tag" title={`${g.files.length} files, linked together`}>
              {exts.length === g.files.length ? exts.join(" · ") : `${g.files.length} files`}</span>}
          </div>
          {s.exists
            ? <SongWave path={s.path} meta={{ title: s.name }} height={20} />
            : <div className="sub col-trunc" style={{ margin: 0, fontSize: 12 }}>File has been moved or deleted</div>}
          <div className="faint col-trunc unm-where">
            in {folders.join(", ")}{s.mtime ? <span className="unm-when-sub"> · exported {fmtWhen(s.mtime)}</span> : null}
          </div>
        </div>
        <div className="sub col-num unm-when" style={{ margin: 0, fontSize: 12 }}>{fmtWhen(s.mtime)}</div>
        {setAsideRow ? (
          <div className="sub" style={{ margin: 0, fontSize: 12 }}>Marked as not a song</div>
        ) : (
          <div className="unm-pick">
            <ProjectPick items={items} value={pid} guesses={guessesOf(g)} song={s.name}
              onPick={(id) => setPicked((p) => ({ ...p, [g.key]: id }))} />
            <div className="faint unm-why">
              {s.kind === "sample" ? <>Looks like a sample: {s.suggest_why}</>
                : sug ? <>Suggested: {sug.suggest_why}</> : !pid && !guessesOf(g).length ? "No likely project found" : " "}
            </div>
          </div>
        )}
        <div className="song-actions">
          {setAsideRow ? (
            <Button variant="ghost" size="sm" disabled={busy === g.key}
              onClick={() => run(g.key, each(g, (p) => api.ignoreSong(p, false)))}>Put back</Button>
          ) : (
            <>
              <Button size="sm" disabled={!pid || busy === g.key} onClick={() => link(g)}>Link</Button>
              <button className="iconbtn" disabled={busy === g.key} title="Not a song: stop listing it here"
                aria-label={`${s.name} is not a song`} onClick={() => notASong(g)}><Icon name="close" /></button>
            </>
          )}
        </div>
      </div>
    );
  };

  const head = (
    <div className="row cols unm-cols cols-head" aria-hidden>
      <span /><span>Song</span><span className="col-num unm-when">Exported</span><span>Project</span><span />
    </div>
  );

  return (
    <>
      <button className="lib-back" onClick={onBack}><Icon name="arrowLeft" size={14} />Library</button>
      <div className="unm-head">
        <h2 className="unm-title">Songs not matched yet</h2>
        <p className="sub" style={{ margin: 0 }}>
          Songs in your exports folders that Backups couldn't tie to a project. Play one, pick its project and press Link.
          Backups remembers, so songs named like it find their project by themselves next time.
        </p>
      </div>
      {err && <div className="sub" style={{ color: "var(--danger)", margin: "0 0 8px" }}>{err}</div>}
      {songs === null ? (
        <div className="empty">Loading…</div>
      ) : groups.length === 0 && samples.length === 0 ? (
        <EmptyState pose="thumbs-up" title="Every song has a project" say="All matched up.">Nothing is waiting. New songs show here if Backups can't place them.</EmptyState>
      ) : groups.length === 0 ? (
        <div className="empty">Every song has a project. Only things that look like samples are left, below.</div>
      ) : (
        <div className="table unm-table">
          {head}
          {groups.map((g) => row(g))}
        </div>
      )}
      {samples.length > 0 && (
        <div className="unm-group">
          <div className="unm-group__head">
            <button type="button" className="lib-back" aria-expanded={showSamples}
              onClick={() => setShowSamples((v) => !v)}>
              <Icon name={showSamples ? "chevronDown" : "chevronRight"} size={14} />Probably samples ({samples.length})
            </button>
            <span className="faint unm-group__say">Pack sounds, loops and resampled bits. Link any that really are songs.</span>
            <Button variant="ghost" size="sm" disabled={busy === "samples"} onClick={allSamplesAside}>None of these are songs</Button>
          </div>
          {showSamples && <div className="table unm-table">{head}{samples.map((g) => row(g))}</div>}
        </div>
      )}
      {asideGroups.length > 0 && (
        <div className="unm-group">
          <button type="button" className="lib-back" style={{ marginBottom: 8 }} aria-expanded={showAside}
            onClick={() => setShowAside((v) => !v)}>
            <Icon name={showAside ? "chevronDown" : "chevronRight"} size={14} />Not a song ({asideGroups.length})
          </button>
          {showAside && <div className="table unm-table">{head}{asideGroups.map((g) => row(g, true))}</div>}
        </div>
      )}
    </>
  );
}
