import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import {
  addSongs, albumCandidates, albumState, changeSong, groupCandidates, releaseKind, stillWorking, tempoJump, daysToGo, deleteAlbum, FADE_PRESETS, fadeLabel, fmtRelease,
  mainGenre, makeAlbum, MAX_FADE, moveItem, orderSongs, putBack, readyCount, releaseDay, renameAlbum, setCrossfade,
  setReleaseDate, takeOut, useAlbums,
  type Album, type AlbumCandidate, type AlbumSong, type CandidateGroup,
} from "../albums";
import { ago } from "../companion";
import { askConfirm, openMenu, toast, toastWarn, type MenuItem } from "./Desktop";
import { Icon } from "./Icon";
import { Cover } from "./Cover";
import { EmptyState } from "./SlothSpot";
import { PlayButton, playAlbum, stopAlbum, togglePlaying, updateAlbum, useAlbumPlaying, usePlayer, useSongLength, type QueueSong } from "./Player";
import { fuzzyScore } from "../fuzzy";
import { coverColor, genreColor, useLook } from "../look";
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
        : <AlbumTable list={list} onOpen={onOpen} />)}
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

// Crate's list. "6 of 6" already says an album is ready, so the Status column is only
// there while some album has songs left to sort.
function AlbumTable({ list, onOpen }: { list: Album[]; onOpen: (id: string) => void }) {
  const status = list.some((a) => albumState(a).tone === "warn");
  const cols = `alb-cols${status ? "" : " alb-cols--nostatus"}`;
  return (
    <div className="table table--crate">
      <div className={`row cols cols-head ${cols}`}>
        <span /><span /><span>Album</span><span>Out</span><span className="col-num">Songs</span>
        <span className="col-num">Length</span><span>Ready</span>{status && <span>Status</span>}
      </div>
      {list.map((a) => <AlbumRow key={a.id} a={a} cols={cols} status={status} onOpen={() => onOpen(a.id)} />)}
    </div>
  );
}

function StatePill({ a }: { a: Album }) {
  const s = albumState(a);
  if (s.tone !== "warn") return <span />;
  return <span className={`pill alb-pill alb-pill--${s.tone}`}>{s.label}</span>;
}

function AlbumRow({ a, cols, status, onOpen }: { a: Album; cols: string; status: boolean; onOpen: () => void }) {
  return (
    <div className={`row cols ${cols} alb-row`} role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onContextMenu={(e) => openMenu(e, listMenu(a, onOpen))}>
      <span className="stripe alb-stripe" style={{ background: genreColor(mainGenre(a)) }} />
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
      {status && <StatePill a={a} />}
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
        <OutNow a={a} />
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

// On release day an OUT NOW stamp is pressed onto the cover (once, as the page opens);
// after the day it stays there, still.
function OutNow({ a }: { a: Album }) {
  const day = releaseDay(a.release_date);
  if (day === null || day > 0) return null;
  return <span className={`outnow${day === 0 ? " outnow--stamp" : ""}`}>Out now</span>;
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
          ? <div className="albpage__sleeve"><span className="albpage__spine">{a.title}</span><Cover name={a.title} size={184} /><OutNow a={a} /></div>
          : <span className="albpage__art"><Cover name={a.title} size={96} /><OutNow a={a} /></span>}
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
          {a.songs.length > 1 && <Crossfade a={a} />}
        </div>
      </header>

      <div className={`albpage__body${adding ? " albpage__body--adding" : ""}`}><div className="albpage__inner">
        <div className="albpage__main">
          {a.songs.length > 0 && <Planner a={a} />}
          {a.songs.length > 0 && <SongList a={a} app={app} nowAt={nowAt} playing={playing} onPlay={play} onOpenProject={onOpenProject} />}
          {a.songs.length === 0 && !adding && <div className="table"><EmptyState pose="napping" title="No songs on it yet" say="Plenty of room.">
            Press Add songs to pick from your exports.</EmptyState></div>}
          {a.songs.length === 0 && adding && <EmptyDrop a={a} />}
        </div>
        {adding && <AddSongs a={a} app={app} onOpenProject={onOpenProject} />}
      </div></div>
    </div>
  );
}

// The crossfade: four presets on one line, and Custom for a slider. It only changes
// how the album plays here.
function Crossfade({ a }: { a: Album }) {
  const isPreset = (secs: number) => FADE_PRESETS.some((p) => p.secs === secs);
  const [v, setV] = useState(a.crossfade);
  const [custom, setCustom] = useState(!isPreset(a.crossfade));
  useEffect(() => { setV(a.crossfade); if (!isPreset(a.crossfade)) setCustom(true); }, [a.crossfade]);  // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (secs: number) => { setV(secs); if (secs !== a.crossfade) void setCrossfade(a.id, secs).catch((e) => toastWarn(String(e.message))); };
  return (
    <div className="alb-fade" role="group" aria-label="Crossfade" title="Only changes how it plays here. Your files stay as they are.">
      <span className="alb-fade__label">Crossfade</span>
      <span className="seg alb-fade__presets">
        {FADE_PRESETS.map((p) => (
          <button key={p.secs} type="button" title={p.hint} aria-pressed={!custom && v === p.secs}
            className={`seg__opt${!custom && v === p.secs ? " seg__opt--on" : ""}`}
            onClick={() => { setCustom(false); commit(p.secs); }}>{p.label}</button>
        ))}
        <button type="button" title="Any length up to 12 seconds" aria-pressed={custom} aria-expanded={custom}
          className={`seg__opt${custom ? " seg__opt--on" : ""}`} onClick={() => setCustom(true)}>Custom</button>
      </span>
      {custom && <>
        <input type="range" min={0} max={MAX_FADE} step={0.5} value={v} aria-label="Crossfade in seconds"
          aria-valuetext={fadeLabel(v)} onChange={(e) => setV(Number(e.target.value))}
          onPointerUp={() => commit(v)} onKeyUp={() => commit(v)} onBlur={() => commit(v)}
          style={{ ["--fill" as string]: `${(v / MAX_FADE) * 100}%` }} />
        <span className="alb-fade__val">{fadeLabel(v)}</span>
      </>}
    </div>
  );
}

// The same colours as the Library: safe green, changed blue, not backed up grey.
const BACKUP: Record<string, { label: string; cls: string }> = {
  safe: { label: "Safe", cls: "pill--ok" },
  changed: { label: "Changed", cls: "alb-pill--changed" },
  none: { label: "Not backed up", cls: "alb-pill--none" },
};

// Rows glide to their new place whenever the order changes (drag, Alt + arrows, menu),
// like records sliding along in a crate. Skipped when the computer asks for less motion.
function useGlide(list: RefObject<HTMLDivElement | null>, order: string) {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const rows = list.current?.querySelectorAll<HTMLElement>("[data-glide]") ?? [];
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, number>();
    rows.forEach((el) => {
      const key = el.dataset.glide ?? "";
      const top = el.offsetTop;
      next.set(key, top);
      const was = tops.current.get(key);
      if (still || was === undefined || was === top) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${was - top}px)`;
      void el.offsetHeight; // start from the old place
      el.style.transition = "transform var(--dur-slow) var(--ease-glide)";
      el.style.transform = "";
      el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
    });
    tops.current = next;
  }, [list, order]);
}

// The songs in order. Drag a row (or Alt + arrow keys) to move it; the others make room as it goes.
// ── planning: how long it is, how the tempo moves, what's finished ─────────────

const KIND_RULE = "Spotify and Apple Music count 1 to 3 songs as a single, 4 to 6 as an EP, and 7 songs or 30 minutes as an album.";

function Planner({ a }: { a: Album }) {
  const [lens, setLens] = useState<Record<string, number>>({});
  const total = a.songs.reduce((t, s) => t + (lens[s.path] || 0), 0);
  const known = a.songs.every((s) => lens[s.path]);
  const kind = releaseKind(a.songs.length, total);
  const toAlbum = Math.max(0, 30 * 60 - total), songsToAlbum = Math.max(0, 7 - a.songs.length);
  const scale = Math.max(total * 1.08, 40 * 60);
  const working = a.songs.filter((s) => s.working).length;
  const tempos = a.songs.map((s) => s.bpm ?? null);
  const jumps = tempos.slice(1).map((b, i) => tempoJump(tempos[i], b)).filter((j) => j !== null).length;
  return (
    <section className="alb-plan" aria-label="Plan">
      {a.songs.map((s) => <Len key={s.path} path={s.path} onLen={(n) => setLens((l) => (l[s.path] === n ? l : { ...l, [s.path]: n }))} />)}
      <div className="alb-plan__row">
        <span className="alb-plan__label">Length</span>
        <div className="alb-plan__what">
          <div className="alb-plan__line" title={KIND_RULE}>
            <b>{kind === "EP" ? "An EP" : kind === "album" ? "An album" : "A single"}</b>
            <span className="faint"> · {a.songs.length} song{a.songs.length === 1 ? "" : "s"} · {known ? totalLength(total) : total ? `${totalLength(total)}+` : "—"}</span>
            {kind !== "album" && known && <span className="faint"> · album at 30 min or 7 songs: {Math.ceil(toAlbum / 60)} min or {songsToAlbum} song{songsToAlbum === 1 ? "" : "s"} more</span>}
          </div>
          <div className="alb-plan__bar" role="img" aria-label={`${a.songs.length} songs, ${totalLength(total) || "length not known yet"}. The album mark is at 30 minutes.`}>
            {a.songs.map((s, i) => <i key={s.path} style={{ width: `${((lens[s.path] || 0) / scale) * 100}%`, background: coverColor(s.genre || null, s.project || s.title) }}
              title={`${i + 1}. ${s.title}${lens[s.path] ? ` · ${clock(lens[s.path])}` : ""}`} />)}
            <span className="alb-plan__mark" style={{ left: `${(30 * 60 / scale) * 100}%` }}><span>30 min</span></span>
          </div>
        </div>
      </div>
      <div className="alb-plan__row">
        <span className="alb-plan__label">Tempo</span>
        <div className="alb-plan__what alb-plan__tempo">
          {tempos.some((b) => b) && tempos.map((b, i) => {
            const jump = i > 0 ? tempoJump(tempos[i - 1], b) : null;
            return <span key={a.songs[i].path} className="alb-plan__step">
              {i > 0 && <span className={`alb-plan__arrow${jump !== null ? " alb-plan__arrow--jump" : ""}`} aria-hidden>→</span>}
              <span className={`alb-plan__bpm${jump !== null ? " alb-plan__bpm--jump" : ""}`}
                title={jump !== null ? `${a.songs[i - 1].title} at ${Math.round(tempos[i - 1]!)} BPM into ${a.songs[i].title} at ${Math.round(b!)} BPM: a big change of pace. Move a song in between, or let it run straight in with no blend.`
                  : `${i + 1}. ${a.songs[i].title}`}>
                {b ? Math.round(b) : "?"}</span>
            </span>;
          })}
          <span className={`faint${tempos.some((b) => b) ? " alb-plan__note" : ""}`}>{jumps ? `${jumps} big change${jumps === 1 ? "" : "s"} of pace` : tempos.some((b) => b) ? "BPM flows" : "No BPM known yet. Backups reads it from each project."}</span>
        </div>
      </div>
      <div className="alb-plan__row">
        <span className="alb-plan__label">Finished</span>
        <div className="alb-plan__what">
          <span><b>{a.songs.length - working} of {a.songs.length}</b></span>
          {working > 0 && <span className="faint"> · still working on {a.songs.filter((s) => s.working).map((s) => s.title).join(", ")}</span>}
        </div>
      </div>
    </section>
  );
}

// Where a song dragged in from the picker lands: before the row under the pointer.
function dropIndex(list: HTMLElement | null, y: number): number {
  const rows = list ? [...list.querySelectorAll<HTMLElement>("[data-alb-row]")] : [];
  const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
  return i < 0 ? rows.length : i;
}
const dragged = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_SONG);
async function dropSong(a: Album, e: DragEvent, at: number) {
  try {
    const song = JSON.parse(e.dataTransfer.getData(DRAG_SONG)) as { path: string };
    if (a.songs.some((s) => s.path === song.path)) return;
    const after = await addSongs(a.id, [song]);
    const order = after.songs.map((s) => s.path).filter((p) => p !== song.path);
    order.splice(at, 0, song.path);
    if (at < a.songs.length) await orderSongs(a.id, order);
  } catch (err) { toastWarn(String((err as Error).message)); }
}

// An album with no songs yet, while adding: somewhere to drop the first one.
function EmptyDrop({ a }: { a: Album }) {
  const [over, setOver] = useState(false);
  return (
    <div className={`alb-dropzone${over ? " alb-dropzone--over" : ""}`}
      onDragOver={(e) => { if (!dragged(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!dragged(e)) return; e.preventDefault(); setOver(false); void dropSong(a, e, 0); }}>
      <Icon name="plus" size={18} />
      <div><b>Drag songs here</b><br /><span className="faint">or press + beside a song. Drag them up and down later to set the order.</span></div>
    </div>
  );
}

function SongList({ a, app, nowAt, playing, onPlay, onOpenProject }: {
  a: Album; app: AlbumsProps["app"]; nowAt: number; playing: boolean; onPlay: (at: number) => void; onOpenProject?: (s: AlbumSong) => void;
}) {
  const paths = a.songs.map((s) => s.path);
  const [drag, setDrag] = useState<string | null>(null);       // path of the song being dragged
  const [order, setOrder] = useState<string[] | null>(null);   // the order shown while dragging
  const listRef = useRef<HTMLDivElement | null>(null);
  const byPath = new Map(a.songs.map((s) => [s.path, s] as const));
  const shown = order ? order.map((p) => byPath.get(p)).filter((s): s is AlbumSong => !!s) : a.songs;
  useGlide(listRef, shown.map((s) => s.path).join("\n"));
  const endDrag = () => { setDrag(null); setOrder(null); };
  const move = (from: number, to: number) => {
    if (from !== to) void orderSongs(a.id, moveItem(paths, from, to)).catch((e) => toastWarn(String(e.message)));
  };
  const focusRow = (i: number) => requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>("[data-alb-row]")[i]?.focus());
  const remove = (s: AlbumSong) => {
    void takeOut(a.id, s.path).then(() => toast(`Took ${s.title} off ${a.title}.`, {
      label: "Undo", onClick: () => void putBack(a.id, s, paths).catch((e) => toastWarn(String(e.message))),
    })).catch((e) => toastWarn(String(e.message)));
  };
  const backups = app === "backups";
  const [dropAt, setDropAt] = useState<number | null>(null);  // a song from the picker, held over the list
  return (
    <div ref={listRef} className={`table table--crate alb-songs${backups ? " alb-songs--backups" : ""}${dropAt === shown.length ? " alb-songs--drop-end" : ""}`}
      onDragOver={(e) => { if (!dragged(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropAt(dropIndex(listRef.current, e.clientY)); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null); }}
      onDrop={(e) => { if (!dragged(e)) return; e.preventDefault(); const at = dropIndex(listRef.current, e.clientY); setDropAt(null); void dropSong(a, e, at); }}>
      <div className="row cols cols-head alb-song-cols">
        <span /><span className="col-num">#</span><span /><span /><span>Song</span>
        <span className="col-num">Length</span><span className="alb-into">Into next</span>{backups && <span>Backup</span>}<span>Status</span><span />
      </div>
      {shown.map((s, i) => {
        const last = i === shown.length - 1;
        const ri = order ? paths.indexOf(s.path) : i; // its place in the saved order
        const menu: MenuItem[] = [
          { label: "Play from here", onClick: () => onPlay(ri) },
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
        const cls = ["row cols alb-song-cols alb-drag", !order && nowAt === ri ? "alb-song--now" : "",
          drag === s.path ? "alb-drag--lifted" : "", dropAt === i ? "alb-drop-before" : ""].join(" ");
        return (
          <div key={s.path} className={cls} data-alb-row data-glide={s.path} tabIndex={0} draggable
            aria-label={`${i + 1}. ${s.title}. ${s.is_ready ? "Ready" : s.needs.join(", ")}. Alt and arrow keys move it.`}
            onDragStart={(e) => { setDrag(s.path); setOrder(paths); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.path); }}
            onDragOver={(e) => {
              if (dragged(e)) return;  // a song from the picker: the list handles it
              e.preventDefault(); e.dataTransfer.dropEffect = "move";
              if (!drag || drag === s.path) return;
              // Swap once the pointer passes the middle of the row it's heading into.
              const r = e.currentTarget.getBoundingClientRect();
              const below = e.clientY > r.top + r.height / 2;
              setOrder((o) => {
                if (!o) return o;
                const from = o.indexOf(drag), to = o.indexOf(s.path);
                return (to < from && !below) || (to > from && below) ? moveItem(o, from, to) : o;
              });
            }}
            onDrop={(e) => {
              if (dragged(e)) return;
              e.preventDefault();
              if (order && order.join("\n") !== paths.join("\n"))
                void orderSongs(a.id, order).catch((err) => toastWarn(String(err.message)));
              endDrag();
            }}
            onDragEnd={endDrag}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.altKey && e.key === "ArrowUp" && i > 0) { e.preventDefault(); move(i, i - 1); focusRow(i - 1); }
              else if (e.altKey && e.key === "ArrowDown" && !last) { e.preventDefault(); move(i, i + 1); focusRow(i + 1); }
              else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(s); }
              else if (e.key === "Enter") { e.preventDefault(); onPlay(ri); }
            }}
            onContextMenu={(e) => openMenu(e, menu)}>
            <span className="alb-grip" aria-hidden title="Drag to move"><Icon name="rows" size={14} /></span>
            <span className="col-num faint">{i + 1}</span>
            <button type="button" className={`playbtn${nowAt === ri ? " playbtn--on" : ""}`} style={{ width: 28, height: 28 }}
              aria-label={`Play the album from ${s.title}`} title="Play the album from here"
              onClick={(e) => { e.stopPropagation(); if (nowAt === ri) togglePlaying(); else onPlay(ri); }}>
              <Icon name={nowAt === ri && playing ? "pause" : "play"} size={11} />
            </button>
            <Cover name={s.project || s.title} genre={s.genre || null} size={36} label={false} />
            <div className="row__main">
              <div className="row__title" title={s.path}>{s.title}</div>
              <div className="row__sub col-trunc">{s.project
                ? (onOpenProject && s.project_id
                  ? <button type="button" className="linkbtn alb-proj" onClick={(e) => { e.stopPropagation(); onOpenProject(s); }}
                      title={`Open the project ${s.project}`}>{s.project}</button>
                  : <span title={`From the project ${s.project}`}>{s.project}</span>)
                : <span title="Not linked to a project yet">{fileLine(s)}</span>}{s.daw ? ` · ${dawName(s.daw)}` : ""}{s.bpm ? ` · ${s.bpm} BPM` : ""}</div>
            </div>
            <span className="col-num"><SongLen path={s.path} /></span>
            <span className="alb-into">{last ? <span className="faint">—</span>
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

// Songs that aren't on the album yet: one row per project with its newest proper
// mixdown (older versions behind a small arrow), searchable. "+" adds a song to the
// end; dragging one onto the album's song list drops it in that place.
export const DRAG_SONG = "application/x-lazy-album-song";
const SHOW_AT_ONCE = 100;

function AddSongs({ a, app, onOpenProject }: { a: Album; app: AlbumsProps["app"]; onOpenProject?: AlbumsProps["onOpenProject"] }) {
  const [all, setAll] = useState<AlbumCandidate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => { albumCandidates().then(setAll).catch((e) => { setAll([]); setErr(String(e.message)); }); }, []);
  const onIt = new Set(a.songs.map((s) => s.path));
  const left = (all ?? []).filter((c) => !onIt.has(c.path));
  const groups = groupCandidates(left);
  const words = q.trim();
  const score = (g: CandidateGroup) => Math.max(...[g.main, ...g.more].map((c) => fuzzyScore(words, [c.title, c.project, c.genre ?? ""])));
  const shown = words ? groups.map((g) => [g, score(g)] as const).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).map(([g]) => g) : groups;
  const add = (cs: AlbumCandidate[]) => void addSongs(a.id, cs.map(asSong)).catch((e) => toastWarn(String(e.message)));
  const toggleOpen = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const from = app === "backups" ? "your projects' exports" : "your watched folders";
  return (
    <section className="alb-pick" aria-label="Add songs">
      <div className="alb-pick__head">
        <h2>Add songs</h2>
        <p className="faint">From {from}, newest mixdown of each project first. Drag one into place, or press +.</p>
        <label className="alb-search">
          <Icon name="search" size={15} />
          <input type="search" value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Search songs and projects…"
            aria-label="Search songs" spellCheck={false} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
        </label>
      </div>
      {err && <div className="alb__err"><Icon name="alert" />{err}</div>}
      {all === null && <div className="faint alb__wait">Looking for your songs…</div>}
      {all && all.length === 0 && !err && <div className="faint alb__wait">{app === "backups"
        ? "No exported songs found yet. Songs show here once they're linked to a project in the Library."
        : "No songs in your watched folders yet. Add a folder in Settings > Folders."}</div>}
      {all && all.length > 0 && left.length === 0 && <div className="faint alb__wait">Every song is on this album.</div>}
      {left.length > 0 && shown.length === 0 && <div className="faint alb__wait">Nothing matches “{q}”.</div>}
      <div className="alb-pick__list" role="list">
        {shown.slice(0, SHOW_AT_ONCE).map((g) => {
          const isOpen = open.has(g.key) || (!!words && g.more.some((c) => fuzzyScore(words, [c.title]) > fuzzyScore(words, [g.main.title])));
          const newest = Math.max(...[g.main, ...g.more].map((c) => c.exported ?? 0));
          return (
            <div key={g.key} role="listitem" className="alb-pick__group">
              <PickRow c={g.main} main working={stillWorking({ ...g.main, exported: newest })} onAdd={() => add([g.main])} onOpenProject={onOpenProject}
                more={g.more.length ? { n: g.more.length, open: isOpen, toggle: () => toggleOpen(g.key) } : undefined} />
              {isOpen && g.more.map((c) => <PickRow key={c.path} c={c} onAdd={() => add([c])} />)}
            </div>
          );
        })}
      </div>
      {shown.length > SHOW_AT_ONCE && <div className="faint alb__wait">Showing the newest {SHOW_AT_ONCE} of {shown.length}. Search to find the rest.</div>}
    </section>
  );
}

const asSong = (c: AlbumCandidate) => ({ path: c.path, title: c.title, project: c.project, genre: c.genre || "" });
const savedAgo = (t?: number | null) => (t ? ago(t * 1000).replace(/^Just now$/, "just now").replace(/^Yesterday$/, "yesterday") : "");

// One song in the picker. The project's own row shows its cover, name, tempo and when
// it was last saved; a version row under it shows the file and when it was exported.
function PickRow({ c, main = false, working = false, more, onAdd, onOpenProject }: {
  c: AlbumCandidate; main?: boolean; working?: boolean; onAdd: () => void; onOpenProject?: AlbumsProps["onOpenProject"];
  more?: { n: number; open: boolean; toggle: () => void };
}) {
  const meta = { title: c.title, project: c.project, genre: c.genre || null };
  const canOpen = main && onOpenProject && c.project_id;
  return (
    <div className={`alb-pick__row${main ? "" : " alb-pick__row--version"}`} draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData(DRAG_SONG, JSON.stringify(asSong(c))); e.dataTransfer.setData("text/plain", c.title); }}
      onDoubleClick={onAdd} title={`${c.title}\n${c.path}`}>
      {main ? <Cover name={c.project || c.title} genre={c.genre || null} size={36} label={false} /> : <span className="alb-pick__branch" aria-hidden />}
      <div className="alb-pick__main">
        <div className="alb-pick__title col-trunc">{c.title}</div>
        <div className="alb-pick__sub col-trunc">
          {main
            ? <>{c.project
                ? (canOpen
                  ? <button type="button" className="linkbtn alb-proj" title={`Open the project ${c.project}`}
                      onClick={(e) => { e.stopPropagation(); onOpenProject!({ path: c.path, title: c.title, project: c.project, project_id: c.project_id ?? null } as AlbumSong); }}>{c.project}</button>
                  : <span>{c.project}</span>)
                : <span>Not linked to a project</span>}</>
            : <span>exported {savedAgo(c.exported) || "—"}</span>}
        </div>
        {main && (c.saved || more) && <div className="alb-pick__tags">
          {c.saved ? <span className={`pill alb-pill ${working ? "alb-pill--warn" : "alb-pill--ok"}`}
            title={working ? "The project was saved after this export, so you may still be working on it" : "Nothing saved in the project since this export"}>
            {working ? "Still working" : "Finished"}<span className="faint"> · saved {savedAgo(c.saved)}</span></span> : null}
          {more && <button type="button" className="linkbtn alb-pick__more" aria-expanded={more.open} onClick={(e) => { e.stopPropagation(); more.toggle(); }}>
            <Icon name={more.open ? "chevronDown" : "chevronRight"} size={12} />{more.n} more version{more.n === 1 ? "" : "s"}</button>}
        </div>}
      </div>
      <span className="alb-pick__bpm col-num faint" title="Tempo (BPM)">{c.bpm ? Math.round(c.bpm) : ""}</span>
      <span className="alb-pick__len col-num faint">{c.duration ? clock(c.duration) : <SongLen path={c.path} />}</span>
      <PlayButton path={c.path} meta={meta} size={28} />
      <button type="button" className="alb-add__plus" aria-label={`Add ${c.title} to the album`} title="Add to the end of the album"
        onClick={(e) => { e.stopPropagation(); onAdd(); }}><Icon name="plus" size={14} /></button>
    </div>
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
