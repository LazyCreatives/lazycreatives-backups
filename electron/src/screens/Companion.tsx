import { useEffect, useState, type CSSProperties } from "react";
import { makeApi } from "../api";
import type { Config, LibraryItem, Overview } from "../types";
import { useLiveProgress } from "../useProgress";
import { backupAndWait } from "../runBackup";
import { currentLine, currentProject, glance, projectState, recentProjects, stampMs } from "../companionPick";
import { ago, showMain, useGentlePoll, useLookFromOtherWindows, usePinned } from "../companion";
import { dawLabel, fmtDate, fmtSize } from "../format";
import { genreColor, useGenreColors, useLook } from "../look";
import { Cover } from "../components/Cover";
import { Icon } from "../components/Icon";
import { EmptyState } from "../components/SlothSpot";
import { rowKey } from "../components/a11y";
import slothUrl from "../assets/lazy-creatives-sloth.png";

// The narrow window: the project you're working on and whether it's safe, at a glance,
// kept beside your music program. Opened from View > Narrow window (see companion.js).
const api = makeApi();
const RECENT = 6;

export function Companion() {
  useGenreColors();
  useLookFromOtherWindows();
  const [look] = useLook();
  const [pinned, togglePin] = usePinned();
  const live = useLiveProgress();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [err, setErr] = useState(false);
  const [running, setRunning] = useState<string | null>(null);   // project id being backed up from here
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [, setNow] = useState(0);  // re-draws the "5 min ago" times

  const load = () => {
    Promise.all([api.getSettings(), api.overview(), api.library()])
      .then(([c, o, l]) => { setCfg(c); setOv(o); setItems(l.projects); setErr(false); })
      .catch(() => setErr(true));
  };
  useEffect(load, [live.backup.done, live.backup.completed, live.backup.skipped]);
  // Projects saved in the music program show up within half a minute.
  useGentlePoll(() => { load(); setNow((n) => n + 1); }, 30000);

  async function backUp(it: LibraryItem) {
    if (running) return;
    setRunning(it.project_id); setNote(null);
    const res = await backupAndWait({ als_paths: [it.path], find_missing: true, portable: true, layout: "project_date" });
    setRunning(null);
    setNote(res.ok
      ? { id: it.project_id, ok: true, text: "Backed up and checked just now." }
      : { id: it.project_id, ok: false, text: res.reason });
    load();
  }

  const head = (
    <header className="cw-head">
      <img className="cw-head__mark" src={slothUrl} alt="" draggable={false} />
      <span className="cw-head__name">Backups</span>
      <span className="cw-head__space" />
      <button type="button" className={`iconbtn cw-pin${pinned ? " cw-pin--on" : ""}`} aria-pressed={pinned} onClick={togglePin}
        title={pinned ? "Kept on top of other windows. Click to let it go behind" : "Keep this window on top of other windows"}>
        <Icon name="pin" />
      </button>
      <button type="button" className="iconbtn" onClick={() => showMain({ go: "home" })} title="Open the full Backups window" aria-label="Open the full Backups window">
        <Icon name="external" />
      </button>
    </header>
  );
  const shell = (body: React.ReactNode, foot?: React.ReactNode) => (
    <div className="cw" data-look={look}>{head}<div className="cw-body">{body}</div>{foot}</div>
  );

  if (err) return shell(
    <EmptyState pose="tangled" title="Backups lost touch with its engine"
      action={<button className="btn btn--primary" onClick={() => showMain({ go: "home" })}>Open Backups</button>}>
      Open the full window to get it going again. Your backups are safe.
    </EmptyState>);
  if (!cfg || !ov || !items) return shell(<p className="cw-wait">Waking the sloth…</p>);
  if (cfg.sources.length === 0) return shell(
    <EmptyState pose="waving" title="Set up Backups first" say="Show me where your projects live."
      action={<button className="btn btn--primary" onClick={() => showMain({ go: "home" })}>Open Backups</button>}>
      Pick the folders your projects are in, and this window will keep an eye on them.
    </EmptyState>);
  if (items.length === 0) return shell(
    <EmptyState pose="empty-crate" title="No projects found yet"
      action={<button className="btn btn--primary" onClick={() => showMain({ go: "home" })}>Open Backups</button>}>
      Look through your project folders in the full window, then the one you're working on shows here.
    </EmptyState>);

  const g = glance(ov, items, live.backup);
  const cur = currentProject(items);
  const recent = recentProjects(items, cur, RECENT);
  const lastMs = stampMs(ov.last_run);
  const canBackUp = !!ov.nas.path && ov.nas.reachable;
  const pct = live.backup.total > 0 ? Math.round(((live.backup.completed + live.backup.skipped + live.backup.errors) / live.backup.total) * 100) : 0;
  const sub = (it: LibraryItem) => [it.genre, it.bpm ? `${Math.round(it.bpm)} BPM` : "", dawLabel(it.daw)].filter(Boolean).join(" · ");
  const open = (it: LibraryItem) => showMain({ go: "project", name: it.name });

  const glanceBox = (
    <section className={`cw-glance cw-glance--${g.tone}`} aria-live="polite">
      <span className={`dot cw-glance__dot ${{ ok: "dot--ok", changed: "dot--accent", look: "dot--warn", off: "", busy: "dot--accent" }[g.tone]}`} />
      <div className="cw-glance__text">
        <div className="cw-glance__title">{g.title}</div>
        <div className="cw-glance__detail">{g.detail}</div>
      </div>
      <div className="cw-glance__when">
        <span>Last backup</span>
        <b title={ov.last_run ? fmtDate(ov.last_run) : undefined}>{lastMs ? ago(lastMs) : "None yet"}</b>
      </div>
      {live.backup.active && (
        <div className="progress cw-glance__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress__fill" style={{ "--pct": Math.max(3, pct) } as CSSProperties} />
        </div>
      )}
    </section>
  );

  const nowBox = cur && (() => {
    const st = projectState(cur);
    const busy = running === cur.project_id;
    const curNote = note && note.id === cur.project_id ? note : null;
    const label = busy ? "Backing up…" : st.tone === "ok" ? "Back up again" : "Back up now";
    return (
      <section className="cw-section">
        <h2 className="cw-label">Working on now</h2>
        <div className="cw-now" data-tone={st.tone}>
          {look === "crate" && <span className="stripe" style={{ background: genreColor(cur.genre) }} />}
          <button type="button" className="cw-now__art" onClick={() => open(cur)} title="Show this project in Backups" aria-label={`Show ${cur.name} in Backups`}>
            <Cover name={cur.name} genre={cur.genre} size={look === "crate" ? 52 : 76} label={false} />
          </button>
          <div className="cw-now__text">
            <button type="button" className="cw-now__name linkbtn" onClick={() => open(cur)} title={cur.name}>{cur.name}</button>
            <div className="cw-now__sub">{sub(cur) || "No genre yet"}</div>
            <div className={`cw-now__state cw-tone--${st.tone}`}><span className={`dot ${st.dot}`} />{currentLine(cur)}</div>
          </div>
          <dl className="cw-now__facts">
            <div><dt>Saved</dt><dd>{ago(cur.mtime * 1000)}</dd></div>
            <div><dt>Last backup</dt><dd title={cur.last_backup ? fmtDate(cur.last_backup) : undefined}>{cur.last_backup ? ago(stampMs(cur.last_backup)) : "Never"}</dd></div>
          </dl>
          <button type="button" className="btn btn--primary cw-now__go" onClick={() => backUp(cur)}
            disabled={busy || !!running || live.backup.active || !canBackUp}
            title={canBackUp ? "Back up this project now, checked" : "Choose where backups go, and connect that drive, first"}>
            {busy && <span className="cw-spin" aria-hidden="true" />}{label}
          </button>
          {curNote && <div className={`cw-note${curNote.ok ? "" : " cw-note--warn"}`} role="status">{curNote.text}</div>}
        </div>
      </section>
    );
  })();

  const recentList = recent.length > 0 && (
    <section className="cw-section">
      <h2 className="cw-label">Recently saved</h2>
      {look === "crate" ? (
        <div className="table table--crate cw-list">
          {recent.map((it) => {
            const st = projectState(it);
            return (
              <div key={it.project_id} className="row cols cw-cols" role="button" tabIndex={0} title={`${it.name}: show in Backups`}
                onClick={() => open(it)} onKeyDown={rowKey(() => open(it))}>
                <span className="stripe" style={{ background: genreColor(it.genre) }} />
                <Cover name={it.name} genre={it.genre} size={28} label={false} />
                <span className="cw-cols__main">
                  <span className="col-trunc cw-cols__name">{it.name}</span>
                  <span className="cw-cols__when">{ago(it.mtime * 1000)}</span>
                </span>
                <span className={`cw-state cw-tone--${st.tone}`}><span className={`dot ${st.dot}`} />{st.word}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cw-cards">
          {recent.map((it) => {
            const st = projectState(it);
            return (
              <div key={it.project_id} className="cw-card" role="button" tabIndex={0} title={`${it.name}: show in Backups`}
                onClick={() => open(it)} onKeyDown={rowKey(() => open(it))}>
                <Cover name={it.name} genre={it.genre} size={44} label={false} />
                <span className="cw-card__main">
                  <span className="col-trunc cw-card__name">{it.name}</span>
                  <span className="cw-card__when">Saved {ago(it.mtime * 1000).toLowerCase()}</span>
                </span>
                <span className={`cw-state cw-tone--${st.tone}`}><span className={`dot ${st.dot}`} />{st.word}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const foot = (
    <footer className="cw-foot">
      <span className="cw-foot__drive" title={ov.nas.path || undefined}>
        <span className={`dot${!ov.nas.path ? "" : ov.nas.reachable ? " dot--ok" : " dot--error"}`} />
        {!ov.nas.path ? "Backups off" : ov.nas.reachable ? `Drive connected${ov.pool_known ? ` · ${fmtSize(ov.nas.free_bytes)} free` : ""}` : "Backup drive not found"}
      </span>
      <button type="button" className="linkbtn cw-foot__open" onClick={() => showMain({ go: "home" })}>Open Backups</button>
    </footer>
  );

  return shell(<>{glanceBox}{nowBox}{recentList}</>, foot);
}
