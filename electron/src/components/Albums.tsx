import { useEffect, useRef, useState } from "react";
import {
  addSongs, albumCandidates, albumState, changeSong, daysToGo, deleteAlbum, FADE_PRESETS, fadeLabel, fmtRelease,
  makeAlbum, MAX_FADE, moveItem, orderSongs, readyCount, renameAlbum, setCrossfade, setReleaseDate, takeOut, useAlbums,
  type Album, type AlbumCandidate, type AlbumSong,
} from "../albums";
import { askConfirm, openMenu, toast, toastWarn, type MenuItem } from "./Desktop";
import { Icon } from "./Icon";
import { Cover } from "./Cover";
import { EmptyState } from "./SlothSpot";
import { playAlbum, stopAlbum, togglePlaying, updateAlbum, useAlbumPlaying, usePlayer, useSongLength, type QueueSong } from "./Player";
import { fuzzyScore } from "../fuzzy";
import { useLook } from "../look";
import "../albums.css";

// Albums: plan what comes out next. Each album has a title, a release date and songs in
// order, with what each song still needs before release day. Play the whole album with
// the songs blending into each other, to hear it the way a streaming app would play it.
// SHARED FILE: the same file lives in Backups and Uploader (electron/src/components/Albums.tsx).
// Backups shows each song's project and backup; Uploader shows where each song came from.
// The list is shared by both apps; nothing here changes, copies or converts a song.

type Meta = QueueSong["meta"];
export interface AlbumsProps {
  app: "backups" | "uploader";
  open: string | null;                 // an album's id, "new", or null for the list
  onOpen: (id: string) => void;
  onClose: () => void;
  metaFor: (song: AlbumSong, album: Album, i: number) => Meta;
  onOpenProject?: (song: AlbumSong) => void;
  oneLook?: boolean;                   // Uploader: always rows
}

const OTHER = { backups: "Uploader", uploader: "Backups" } as const;
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const totalLength = (t: number) => (t >= 3600 ? `${Math.floor(t / 3600)} h ${Math.round((t % 3600) / 60)} min` : t ? clock(t) : "");
const JOIN_SECS = 15;   // "Play joins only": this long either side of each change

export function Albums(p: AlbumsProps) {
  const { list, error } = useAlbums();
  const [lookPref] = useLook();
  const look = p.oneLook ? "crate" : lookPref;
  const album = p.open && p.open !== "new" ? (list ?? []).find((a) => a.id === p.open) ?? null : null;
  if (album) return <AlbumPage key={album.id} a={album} look={look} {...p} />;
  if (p.open && p.open !== "new" && list) {
    return <div className="alb"><BackLink onClick={p.onClose} />
      <EmptyState pose="searching" title="That album isn't there any more" say="Gone, like a B-side.">
        It may have been deleted in {OTHER[p.app]}.
      </EmptyState></div>;
  }
  return <AlbumList list={list} error={error} look={look} composing={p.open === "new"} {...p} />;
}

function BackLink({ onClick }: { onClick: () => void }) {
  return <button type="button" className="linkbtn alb__back" onClick={onClick}><Icon name="arrowLeft" size={14} />Albums</button>;
}

// ── the list of albums ───────────────────────────────────────────────────────

function AlbumList({ list, error, look, composing, app, onOpen, onClose }: AlbumsProps & {
  list: Album[] | null; error: string | null; look: string; composing: boolean;
}) {
  const empty = list !== null && list.length === 0;
  const next = (list ?? []).find((a) => a.release_date && daysToGo(a.release_date).endsWith("to go"));
  const sub = list === null ? "" : empty ? `Plan what comes out next. Albums here show in ${OTHER[app]} too.`
    : `${list.length} album${list.length === 1 ? "" : "s"}${next ? ` · ${next.title} ${daysToGo(next.release_date).replace(" to go", " away")}` : ""} · shared with ${OTHER[app]}`;
  return (
    <div className="alb">
      <header className="page-head">
        <div style={{ minWidth: 0 }}><h1>Albums</h1>{sub && <p className="sub">{sub}</p>}</div>
        {!composing && !empty && <div className="page-head__actions">
          <button type="button" className="btn btn--primary" onClick={() => onOpen("new")}><Icon name="plus" />New album</button>
        </div>}
      </header>
      {error && <div className="alb__err"><Icon name="alert" />{error}</div>}
      {(composing || empty) && <Composer first={empty} onMade={(a) => onOpen(a.id)} onCancel={empty ? undefined : onClose} />}
      {list === null && <div className="table"><div className="row faint alb__wait">Getting your albums…</div></div>}
      {list && list.length > 0 && (look === "sleeve"
        ? <div className="sleeves">{list.map((a) => <AlbumSleeve key={a.id} a={a} onOpen={() => onOpen(a.id)} />)}</div>
        : <div className="table table--crate">
            <div className="row cols cols-head alb-cols">
              <span /><span /><span>Album</span><span>Out</span><span className="col-num">Songs</span>
              <span className="col-num">Length</span><span>Ready</span><span>Status</span>
            </div>
            {list.map((a) => <AlbumRow key={a.id} a={a} onOpen={() => onOpen(a.id)} />)}
          </div>)}
    </div>
  );
}

function listMenu(a: Album, open: () => void): MenuItem[] {
  return [{ label: "Open", onClick: open }, "-", { label: "Delete album…", danger: true, onClick: () => void confirmDelete(a) }];
}

async function confirmDelete(a: Album, after?: () => void) {
  const ok = await askConfirm({
    title: `Delete “${a.title}”?`,
    body: "The album goes from Backups and Uploader. Its songs stay where they are, untouched.",
    confirm: "Delete album", danger: true,
  });
  if (!ok) return;
  try { await deleteAlbum(a.id); toast(`Deleted ${a.title}.`); after?.(); }
  catch (e) { toastWarn(String((e as Error).message)); }
}

function ReadyBar({ a }: { a: Album }) {
  const n = readyCount(a), all = a.songs.length;
  return (
    <span className="alb-ready">
      <span className="alb-ready__bar" aria-hidden><i style={{ width: all ? `${(n / all) * 100}%` : 0 }} /></span>
      <span className="alb-ready__n">{all ? `${n} of ${all}` : "—"}</span>
    </span>
  );
}

function StatePill({ a }: { a: Album }) {
  const s = albumState(a);
  return <span className={`pill alb-pill alb-pill--${s.tone}`}>{s.label}</span>;
}

function AlbumRow({ a, onOpen }: { a: Album; onOpen: () => void }) {
  return (
    <div className="row cols alb-cols alb-row" role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onContextMenu={(e) => openMenu(e, listMenu(a, onOpen))}>
      <span className="stripe alb-stripe" />
      <Cover name={a.title} size={36} label={false} />
      <div className="row__main">
        <div className="row__title" title={a.title}>{a.title}</div>
        <div className="row__sub col-trunc">{a.songs.slice(0, 3).map((s) => s.title).join(", ") || "No songs yet"}</div>
      </div>
      {a.release_date
        ? <div className="row__main"><div className="col-trunc">{fmtRelease(a.release_date)}</div>
            <div className="row__sub col-trunc alb-when">{daysToGo(a.release_date)}</div></div>
        : <span className="faint">No date yet</span>}
      <span className="col-num">{a.songs.length}</span>
      <span className="col-num"><LengthOf a={a} /></span>
      <ReadyBar a={a} />
      <StatePill a={a} />
    </div>
  );
}

// The album's running time, from the songs' files (read only as far as their length).
function LengthOf({ a }: { a: Album }) {
  const [lens, setLens] = useState<Record<string, number>>({});
  const total = a.songs.reduce((t, s) => t + (lens[s.path] || 0), 0);
  const known = a.songs.every((s) => lens[s.path]);
  return <>
    {a.songs.map((s) => <Len key={s.path} path={s.path} onLen={(n) => setLens((l) => (l[s.path] === n ? l : { ...l, [s.path]: n }))} />)}
    {a.songs.length ? (known ? totalLength(total) : total ? `${totalLength(total)}+` : "—") : "—"}
  </>;
}

function Len({ path, onLen }: { path: string; onLen: (n: number) => void }) {
  const n = useSongLength(path);
  useEffect(() => { if (n) onLen(n); }, [n]);  // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function AlbumSleeve({ a, onOpen }: { a: Album; onOpen: () => void }) {
  const s = albumState(a);
  return (
    <div className="sleeve alb-sleeve" role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onContextMenu={(e) => openMenu(e, listMenu(a, onOpen))}>
      <div className="sleeve__art">
        <Cover name={a.title} />
        <span className="sleeve__badge"><span className={`dot ${s.tone === "ok" ? "dot--ok" : s.tone === "warn" ? "dot--warn" : ""}`} />{s.label}</span>
      </div>
      <div className="sleeve__meta">
        <div className="sleeve__name" title={a.title}>{a.title}</div>
        <div className="sleeve__sub">{[a.release_date ? fmtRelease(a.release_date) : "No date yet",
          `${a.songs.length} song${a.songs.length === 1 ? "" : "s"}`].join(" · ")}</div>
      </div>
    </div>
  );
}

// Name a new album and, if you know it, the day it comes out.
function Composer({ first, onMade, onCancel }: { first: boolean; onMade: (a: Album) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function make() {
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    try { onMade(await makeAlbum(name.trim(), date)); }
    catch (e) { setErr(String((e as Error).message)); setBusy(false); }
  }
  return (
    <div className={`alb-compose${first ? " alb-compose--first" : ""}`}>
      {first && <EmptyState pose="empty-crate" title="No albums yet" say="Every record starts as a pile of songs.">
        Name one here, then add songs from your exports. You'll see what each song still needs before release day.
      </EmptyState>}
      <div className="alb-compose__row">
        <input type="text" value={name} maxLength={200} autoFocus placeholder="Album name, e.g. Night Drive"
          aria-label="Album name" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void make(); if (e.key === "Escape" && onCancel) onCancel(); }} />
        <label className="alb-compose__date"><span>Out on</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Release date (optional)" /></label>
        <button type="button" className="btn btn--primary" disabled={!name.trim() || busy} onClick={() => void make()}>{busy ? "Making…" : "Make album"}</button>
        {onCancel && <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>}
      </div>
      {err && <div className="alb__err"><Icon name="alert" />{err}</div>}
    </div>
  );
}

// ── one album ────────────────────────────────────────────────────────────────

function AlbumPage({ a, look, app, onClose, metaFor, onOpenProject }: AlbumsProps & { a: Album; look: string }) {
  const [renaming, setRenaming] = useState(false);
  const [dating, setDating] = useState(false);
  const [adding, setAdding] = useState(a.songs.length === 0);
  const run = useAlbumPlaying();
  const joinsKey = `joins:${a.id}`;
  const here = run && (run.key === a.id || run.key === joinsKey) ? run : null;
  const nowAt = here ? (here.key === joinsKey ? Math.ceil(here.at / 2) : here.at) : -1;
  const { playing } = usePlayer(here ? a.songs[nowAt]?.path : null);
  const sleeve = look === "sleeve";

  const queue = (): QueueSong[] => a.songs.map((s, i) => ({ path: s.path, meta: metaFor(s, a, i), join: s.gapless_after ? "gapless" : "fade" }));
  const joinsQueue = (): QueueSong[] => {
    const out: QueueSong[] = [];
    for (let i = 0; i + 1 < a.songs.length; i++) {
      const s = a.songs[i], n = a.songs[i + 1];
      out.push({ path: s.path, meta: metaFor(s, a, i), from: -JOIN_SECS, join: s.gapless_after ? "gapless" : "fade" });
      out.push({ path: n.path, meta: metaFor(n, a, i + 1), until: JOIN_SECS + (s.gapless_after ? 0 : a.crossfade), join: "cut" });
    }
    return out;
  };
  // Reordering or changing the crossfade while it plays carries on from the same song.
  useEffect(() => {
    if (run?.key === a.id) updateAlbum(a.id, queue(), a.crossfade);
  }, [a.songs, a.crossfade]);  // eslint-disable-line react-hooks/exhaustive-deps

  const play = (at = 0) => playAlbum(a.id, queue(), at, a.crossfade);
  const playJoins = () => playAlbum(joinsKey, joinsQueue(), 0, a.crossfade);
  const save = (p: Promise<unknown>) => p.catch((e) => toastWarn(String((e as Error).message)));
  const n = readyCount(a);
  const left = a.songs.length - n;

  const pageMenu: MenuItem[] = [
    { label: "Rename", onClick: () => setRenaming(true) },
    { label: a.release_date ? "Change release date" : "Set release date", onClick: () => setDating(true) },
    "-",
    { label: "Delete album…", danger: true, onClick: () => void confirmDelete(a, onClose) },
  ];

  return (
    <div className={`alb albpage albpage--${look}`}>
      <BackLink onClick={onClose} />
      <header className="albpage__head">
        {sleeve
          ? <div className="albpage__sleeve"><span className="albpage__spine">{a.title}</span><Cover name={a.title} size={184} /></div>
          : <Cover name={a.title} size={96} className="albpage__art" />}
        <div className="albpage__info">
          <div className="eyebrow">Album{a.release_date ? ` · out ${fmtRelease(a.release_date)} · ${daysToGo(a.release_date)}` : " · no release date yet"} · also in {OTHER[app]}</div>
          {renaming
            ? <RenameBox title={a.title} onDone={(t) => { setRenaming(false); if (t && t !== a.title) void save(renameAlbum(a.id, t)); }} />
            : <h1 className="albpage__title" title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>{a.title}</h1>}
          <div className="albpage__line">
            {a.songs.length ? <>{a.songs.length} song{a.songs.length === 1 ? "" : "s"} · <LengthOf a={a} /> · {left ? `${n} ready, ${left} need${left === 1 ? "s" : ""} something` : "all ready"}</> : "No songs yet"}
          </div>
          {dating && <div className="albpage__date">
            <input type="date" defaultValue={a.release_date} autoFocus aria-label="Release date"
              onKeyDown={(e) => { if (e.key === "Enter") { void save(setReleaseDate(a.id, (e.target as HTMLInputElement).value)); setDating(false); } if (e.key === "Escape") setDating(false); }}
              onBlur={(e) => { if (e.target.value !== a.release_date) void save(setReleaseDate(a.id, e.target.value)); setDating(false); }} />
            {a.release_date && <button type="button" className="btn btn--quiet btn--sm" onMouseDown={(e) => e.preventDefault()}
              onClick={() => { void save(setReleaseDate(a.id, "")); setDating(false); }}>No date</button>}
          </div>}
          <div className="albpage__actions">
            {a.songs.length > 0 && (here
              ? <button type="button" className="btn btn--primary btn--sm" onClick={() => togglePlaying()}>
                  <Icon name={playing ? "pause" : "play"} size={14} />{playing ? "Pause album" : "Play album"}</button>
              : <button type="button" className="btn btn--primary btn--sm" onClick={() => play(0)}><Icon name="play" size={14} />Play album</button>)}
            {a.songs.length > 1 && <button type="button" className="btn btn--sm" onClick={playJoins}
              title={`Play ${JOIN_SECS} seconds either side of every change of song`}><Icon name="headphones" size={14} />Play joins only</button>}
            {here && <button type="button" className="btn btn--quiet btn--sm" onClick={stopAlbum}>Stop</button>}
            <button type="button" className={`btn btn--sm${adding ? " btn--ghost" : ""}`} onClick={() => setAdding((x) => !x)}>
              <Icon name={adding ? "close" : "plus"} size={14} />{adding ? "Done adding" : "Add songs"}</button>
            {!a.release_date && !dating && <button type="button" className="btn btn--quiet btn--sm" onClick={() => setDating(true)}>Set release date</button>}
            <button type="button" className="iconbtn" aria-label="More" title="More"
              onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, pageMenu); }}>
              <Icon name="more" /></button>
          </div>
        </div>
      </header>

      {a.songs.length > 1 && <Mixer a={a} />}
      {a.songs.length > 0 && <SongList a={a} app={app} nowAt={nowAt} onPlay={play} onOpenProject={onOpenProject} />}
      {a.songs.length === 0 && !adding && <div className="table"><EmptyState pose="napping" title="No songs on it yet" say="Plenty of room.">
        Press Add songs to pick from your exports.</EmptyState></div>}
      {adding && <AddSongs a={a} app={app} />}
    </div>
  );
}

// The crossfade: a slider and a few presets. It only changes how the album plays here.
function Mixer({ a }: { a: Album }) {
  const [v, setV] = useState(a.crossfade);
  useEffect(() => setV(a.crossfade), [a.crossfade]);
  const commit = (secs: number) => { setV(secs); if (secs !== a.crossfade) void setCrossfade(a.id, secs).catch((e) => toastWarn(String(e.message))); };
  return (
    <div className="alb-mixer" role="group" aria-label="Crossfade">
      <span className="alb-mixer__label">Crossfade</span>
      <input type="range" min={0} max={MAX_FADE} step={0.5} value={v} aria-label="Crossfade in seconds"
        aria-valuetext={fadeLabel(v)} onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={() => commit(v)} onKeyUp={() => commit(v)} onBlur={() => commit(v)}
        style={{ ["--fill" as string]: `${(v / MAX_FADE) * 100}%` }} />
      <span className="alb-mixer__val">{fadeLabel(v)}</span>
      <span className="seg alb-mixer__presets" role="group" aria-label="Crossfade presets">
        {FADE_PRESETS.map((p) => (
          <button key={p.secs} type="button" title={p.hint} aria-pressed={v === p.secs}
            className={`seg__opt${v === p.secs ? " seg__opt--on" : ""}`} onClick={() => commit(p.secs)}>{p.label}</button>
        ))}
      </span>
      <span className="alb-mixer__note faint">Only changes how it plays here. Your files stay as they are.</span>
    </div>
  );
}

const BACKUP: Record<string, { label: string; cls: string }> = {
  safe: { label: "Safe", cls: "pill--ok" },
  changed: { label: "Changed", cls: "pill--private" },
  none: { label: "Not backed up", cls: "pill--error" },
};

// The songs in order. Drag a row (or Alt + arrow keys) to move it.
function SongList({ a, app, nowAt, onPlay, onOpenProject }: {
  a: Album; app: AlbumsProps["app"]; nowAt: number; onPlay: (at: number) => void; onOpenProject?: (s: AlbumSong) => void;
}) {
  const paths = a.songs.map((s) => s.path);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const move = (from: number, to: number) => {
    if (from !== to) void orderSongs(a.id, moveItem(paths, from, to)).catch((e) => toastWarn(String(e.message)));
  };
  const focusRow = (i: number) => requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>("[data-alb-row]")[i]?.focus());
  const remove = (s: AlbumSong) => {
    void takeOut(a.id, s.path).then(() => toast(`Took ${s.title} off ${a.title}.`, {
      label: "Undo", onClick: () => void addSongs(a.id, [{ path: s.path, title: s.title, project: s.project }])
        .then(() => orderSongs(a.id, paths)),
    })).catch((e) => toastWarn(String(e.message)));
  };
  const backups = app === "backups";
  return (
    <div ref={listRef} className={`table table--crate alb-songs${backups ? " alb-songs--backups" : ""}`}>
      <div className="row cols cols-head alb-song-cols">
        <span /><span className="col-num">#</span><span /><span /><span>Song</span>
        <span className="col-num">Length</span><span>Into next</span>{backups && <span>Backup</span>}<span>Status</span><span />
      </div>
      {a.songs.map((s, i) => {
        const last = i === a.songs.length - 1;
        const menu: MenuItem[] = [
          { label: "Play from here", onClick: () => onPlay(i) },
          ...(onOpenProject && s.project_id ? [{ label: "Open project", onClick: () => onOpenProject(s) }] : []),
          "-",
          { label: "Move to top", disabled: i === 0, onClick: () => move(i, 0) },
          { label: "Move up", disabled: i === 0, onClick: () => move(i, i - 1) },
          { label: "Move down", disabled: last, onClick: () => move(i, i + 1) },
          { label: "Move to bottom", disabled: last, onClick: () => move(i, a.songs.length - 1) },
          "-",
          s.ready === null
            ? { label: s.is_ready ? "Mark not ready" : "Mark ready anyway", onClick: () => void changeSong(a.id, { path: s.path, ready: !s.is_ready }) }
            : { label: "Let the app judge again", onClick: () => void changeSong(a.id, { path: s.path, clear_ready: true }) },
          ...(!last ? [{ label: s.gapless_after ? "Blend into the next song" : "Run straight into the next song", onClick: () => void changeSong(a.id, { path: s.path, gapless_after: !s.gapless_after }) }] : []),
          "-",
          { label: "Take off this album", danger: true, onClick: () => remove(s) },
        ];
        const cls = ["row cols alb-song-cols alb-drag", nowAt === i ? "alb-song--now" : "", drag === i ? "alb-drag--lifted" : "",
          over === i && drag !== null && drag !== i ? (drag < i ? "alb-drag--below" : "alb-drag--above") : ""].join(" ");
        return (
          <div key={s.path} className={cls} data-alb-row tabIndex={0} draggable
            aria-label={`${i + 1}. ${s.title}. ${s.is_ready ? "Ready" : s.needs.join(", ")}. Alt and arrow keys move it.`}
            onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.path); }}
            onDragEnter={() => setOver(i)}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.altKey && e.key === "ArrowUp" && i > 0) { e.preventDefault(); move(i, i - 1); focusRow(i - 1); }
              else if (e.altKey && e.key === "ArrowDown" && !last) { e.preventDefault(); move(i, i + 1); focusRow(i + 1); }
              else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(s); }
              else if (e.key === "Enter") { e.preventDefault(); onPlay(i); }
            }}
            onContextMenu={(e) => openMenu(e, menu)}>
            <span className="alb-grip" aria-hidden title="Drag to move"><Icon name="rows" size={14} /></span>
            <span className="col-num faint">{i + 1}</span>
            <button type="button" className={`playbtn${nowAt === i ? " playbtn--on" : ""}`} style={{ width: 28, height: 28 }}
              aria-label={`Play the album from ${s.title}`} title="Play the album from here"
              onClick={(e) => { e.stopPropagation(); if (nowAt === i) togglePlaying(); else onPlay(i); }}>
              <Icon name={nowAt === i ? "pause" : "play"} size={11} />
            </button>
            <Cover name={s.project || s.title} size={36} label={false} />
            <div className="row__main">
              <div className="row__title" title={s.path}>{s.title}</div>
              <div className="row__sub col-trunc">{s.project
                ? (onOpenProject && s.project_id
                  ? <button type="button" className="linkbtn alb-proj" onClick={(e) => { e.stopPropagation(); onOpenProject(s); }}
                      title={`Open the project ${s.project}`}>{s.project}</button>
                  : <span title={`From the project ${s.project}`}>{s.project}</span>)
                : <span title="Not linked to a project yet">{fileLine(s)}</span>}{s.daw ? ` · ${dawName(s.daw)}` : ""}</div>
            </div>
            <span className="col-num"><SongLen path={s.path} /></span>
            <span>{last ? <span className="faint">—</span>
              : <button type="button" className={`alb-join${s.gapless_after ? " alb-join--gapless" : ""}`}
                  title={s.gapless_after ? "Runs straight into the next song. Click to blend instead." : "Click if this song should run straight into the next one, with no blend."}
                  onClick={() => void changeSong(a.id, { path: s.path, gapless_after: !s.gapless_after })}>
                  <JoinMark gapless={s.gapless_after || a.crossfade === 0} />
                  {s.gapless_after ? "No gap" : a.crossfade ? `${fadeLabel(a.crossfade)} blend` : "Next song"}
                </button>}</span>
            {backups && <span>{s.backup ? <span className={`pill ${BACKUP[s.backup].cls}`}>{BACKUP[s.backup].label}</span> : <span className="faint">—</span>}</span>}
            <span className="alb-status">
              <button type="button" className={`pill alb-pill alb-pill--${s.is_ready ? "ok" : "warn"} linkbtn`}
                title={[...(s.needs.length ? s.needs : ["Nothing missing"]), s.ready !== null ? "(you set this yourself)" : "Click to mark it ready anyway"].join("\n")}
                onClick={() => void changeSong(a.id, s.ready !== null ? { path: s.path, clear_ready: true } : { path: s.path, ready: !s.is_ready })}>
                {s.is_ready ? (s.ready ? "Ready (you)" : "Ready") : s.needs[0] ?? "Not ready"}
              </button>
              {!s.is_ready && s.needs.length > 1 && <span className="faint alb-more">+{s.needs.length - 1}</span>}
            </span>
            <span className="col-act">
              <button type="button" className="iconbtn" aria-label={`Take ${s.title} off the album`} title="Take off this album"
                onClick={(e) => { e.stopPropagation(); remove(s); }}><Icon name="close" /></button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// The song's file name, which says which export it is (a WAV, a "final v2").
const fileLine = (s: AlbumSong) => s.path.split(/[\\/]/).pop() || s.path;

// Music programs by their proper names ("fl" -> "FL Studio").
const DAWS: Record<string, string> = {
  ableton: "Ableton", fl: "FL Studio", flstudio: "FL Studio", reaper: "Reaper", logic: "Logic Pro",
  studioone: "Studio One", bitwig: "Bitwig", dawproject: "DAWproject",
};
const dawName = (d: string) => DAWS[d.toLowerCase().replace(/[\s_-]/g, "")] ?? d;

function SongLen({ path }: { path: string }) {
  const n = useSongLength(path);
  return <>{n ? clock(n) : "—"}</>;
}

// Two lines crossing for a blend, one straight line for no gap.
function JoinMark({ gapless }: { gapless: boolean }) {
  return (
    <svg width="26" height="12" viewBox="0 0 26 12" aria-hidden className="alb-join__mark">
      {gapless
        ? <path d="M1 6H25" stroke="currentColor" strokeWidth="1.5" fill="none" />
        : <><path d="M1 2L25 10" stroke="currentColor" strokeWidth="1.5" fill="none" opacity=".5" />
            <path d="M1 10L25 2" stroke="currentColor" strokeWidth="1.5" fill="none" /></>}
    </svg>
  );
}

// Songs that aren't on the album yet, with a search. "+" adds one to the end.
function AddSongs({ a, app }: { a: Album; app: AlbumsProps["app"] }) {
  const [all, setAll] = useState<AlbumCandidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { albumCandidates().then(setAll).catch((e) => { setAll([]); setErr(String(e.message)); }); }, []);
  const onIt = new Set(a.songs.map((s) => s.path));
  const left = (all ?? []).filter((c) => !onIt.has(c.path));
  const shown = q.trim() ? left.filter((c) => fuzzyScore(q, [c.title, c.project, c.genre ?? ""]) > 0) : left;
  const add = (cs: AlbumCandidate[]) => void addSongs(a.id, cs.map((c) => ({ path: c.path, title: c.title, project: c.project })))
    .catch((e) => toastWarn(String(e.message)));
  const from = app === "backups" ? "your projects' exports" : "your watched folders";
  return (
    <section className="alb-add" aria-label="Add songs">
      <div className="alb-add__head">
        <h2>Add from {from}</h2>
        <label className="alb-search">
          <Icon name="search" size={15} />
          <input type="search" value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Search songs and projects…"
            aria-label="Search songs" spellCheck={false} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
        </label>
        {shown.length > 1 && q.trim() && <button type="button" className="btn btn--sm" onClick={() => add(shown)}>Add all {shown.length}</button>}
      </div>
      {err && <div className="alb__err"><Icon name="alert" />{err}</div>}
      {all === null && <div className="faint alb__wait">Looking for your songs…</div>}
      {all && all.length === 0 && !err && <div className="faint alb__wait">{app === "backups"
        ? "No exported songs found yet. Songs show here once they're linked to a project in the Library."
        : "No songs in your watched folders yet. Add a folder in Settings."}</div>}
      {all && all.length > 0 && left.length === 0 && <div className="faint alb__wait">Every song is on this album.</div>}
      {left.length > 0 && shown.length === 0 && <div className="faint alb__wait">Nothing matches “{q}”.</div>}
      <div className="alb-add__list">
        {shown.slice(0, 200).map((c) => (
          <button key={c.path} type="button" className="alb-add__row" onClick={() => add([c])} title={`Add ${c.title}`}>
            <Cover name={c.project || c.title} genre={c.genre} size={32} label={false} />
            <span className="alb-add__title col-trunc">{c.title}</span>
            <span className="alb-add__meta faint col-trunc">{[c.project, c.daw ? dawName(c.daw) : ""].filter(Boolean).join(" · ") || "Not linked"}</span>
            <span className="alb-add__len faint">{c.duration ? clock(c.duration) : "—"}</span>
            <span className="alb-add__plus" aria-hidden><Icon name="plus" size={14} /></span>
          </button>
        ))}
      </div>
      {shown.length > 200 && <div className="faint alb__wait">Showing the first 200. Search to find the rest.</div>}
    </section>
  );
}

function RenameBox({ title, onDone }: { title: string; onDone: (t: string | null) => void }) {
  const [v, setV] = useState(title);
  return (
    <input className="albpage__rename" value={v} maxLength={200} autoFocus aria-label="Album name"
      onChange={(e) => setV(e.target.value)} onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => { if (e.key === "Enter") onDone(v.trim() || null); if (e.key === "Escape") onDone(null); }} />
  );
}
