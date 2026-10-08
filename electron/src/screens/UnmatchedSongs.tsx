import { useEffect, useMemo, useState } from "react";
import { openMenu, toast } from "../components/Desktop";
import { copyText } from "../desktop";
import { makeApi } from "../api";
import type { LibraryItem, UnmatchedSong } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { PlayButton, SongWave } from "../components/Player";
import { EmptyState } from "../components/SlothSpot";
import { fmtDay } from "../format";

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
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    api.unmatchedSongs().then((r) => setSongs(r.songs)).catch((e) => setErr(String(e.message ?? e)));
    api.unmatchedSongs(true).then((r) => setAside(r.songs)).catch(() => {});
  }
  useEffect(load, []);

  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.project_id, i])), [items]);
  const choices = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const target = (s: UnmatchedSong) => picked[s.path] ?? (s.suggest_id && byId[s.suggest_id] ? s.suggest_id : "");

  async function run(path: string, fn: () => Promise<unknown>) {
    setBusy(path); setErr(null);
    try { await fn(); load(); onChanged?.(); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(null); }
  }
  function link(s: UnmatchedSong) {
    const pid = target(s);
    if (!pid) return;
    run(s.path, () => api.linkExport(s.path, pid));
    toast(`${s.name} is now with ${byId[pid]?.name ?? "that project"}.`,
      { label: "Undo", onClick: () => run(s.path, () => api.unlinkExport(s.path, pid)) });
  }
  function notASong(s: UnmatchedSong) {
    run(s.path, () => api.ignoreSong(s.path));
    toast(`${s.name} won't be listed again.`, { label: "Undo", onClick: () => run(s.path, () => api.ignoreSong(s.path, false)) });
  }

  const row = (s: UnmatchedSong, setAsideRow = false) => {
    const pid = target(s);
    const sug = s.suggest_id ? byId[s.suggest_id] : undefined;
    return (
      <div key={s.path} className="row cols unm-cols" onContextMenu={(ev) => openMenu(ev, [
        ...(s.exists ? [{ label: "Show the file", onClick: () => bridge()?.revealPath?.(s.path) }] : []),
        { label: "Copy file path", onClick: () => { copyText(s.path); } },
      ])}>
        {s.exists ? <PlayButton path={s.path} title={s.name} meta={{ title: s.name }} /> : <span />}
        <div style={{ minWidth: 0 }}>
          <div className="song-name" title={s.path}>{s.name}{s.kind === "stem" && <span className="unm-tag">stem</span>}</div>
          {s.exists
            ? <SongWave path={s.path} meta={{ title: s.name }} height={20} />
            : <div className="sub col-trunc" style={{ margin: 0, fontSize: 12 }}>File has been moved or deleted</div>}
          <div className="faint col-trunc unm-where">in {folderOf(s.path)}</div>
        </div>
        <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>{fmtWhen(s.mtime)}</div>
        {setAsideRow ? (
          <div className="sub" style={{ margin: 0, fontSize: 12 }}>Marked as not a song</div>
        ) : (
          <div className="unm-pick">
            <select className={pid ? "lib-pick lib-pick--on" : "lib-pick"} value={pid} aria-label={`Project for ${s.name}`}
              onChange={(e) => setPicked((p) => ({ ...p, [s.path]: e.target.value }))}>
              <option value="">Pick a project…</option>
              {choices.map((i) => <option key={i.project_id} value={i.project_id}>{i.name}</option>)}
            </select>
            <div className="faint unm-why">
              {sug && pid === s.suggest_id ? <>Suggested: {s.suggest_why}</> : !s.suggest_id ? "No likely project found" : " "}
            </div>
          </div>
        )}
        <div className="song-actions">
          {setAsideRow ? (
            <Button variant="ghost" size="sm" disabled={busy === s.path}
              onClick={() => run(s.path, () => api.ignoreSong(s.path, false))}>Put back</Button>
          ) : (
            <>
              <Button size="sm" disabled={!pid || busy === s.path} onClick={() => link(s)}>Link</Button>
              <button className="iconbtn" disabled={busy === s.path} title="Not a song: stop listing it here"
                aria-label={`${s.name} is not a song`} onClick={() => notASong(s)}><Icon name="close" /></button>
            </>
          )}
        </div>
      </div>
    );
  };

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
      ) : songs.length === 0 ? (
        <EmptyState pose="thumbs-up" title="Every song has a project" say="All matched up.">Nothing is waiting. New songs show here if Backups can't place them.</EmptyState>
      ) : (
        <div className="table unm-table">
          <div className="row cols unm-cols cols-head" aria-hidden>
            <span /><span>Song</span><span className="col-num">Exported</span><span>Project</span><span />
          </div>
          {songs.map((s) => row(s))}
        </div>
      )}
      {aside.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button type="button" className="lib-back" style={{ marginBottom: 8 }} aria-expanded={showAside}
            onClick={() => setShowAside((v) => !v)}>
            <Icon name={showAside ? "chevronDown" : "chevronRight"} size={14} />Not a song ({aside.length})
          </button>
          {showAside && <div className="table unm-table">{aside.map((s) => row(s, true))}</div>}
        </div>
      )}
    </>
  );
}
