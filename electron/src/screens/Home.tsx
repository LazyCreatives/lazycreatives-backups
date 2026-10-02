import { useEffect, useRef, useState } from "react";
import { makeApi } from "../api";
import type { Overview, LibraryItem } from "../types";
import type { BackupProgress } from "../useProgress";
import { fmtSize, fmtDate, fmtInterval, fmtClock, shortPath, dawLabel } from "../format";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { PlayButton, SongWave, type SongMeta } from "../components/Player";
import { genreColor, useLook } from "../look";
import "../home.css";

const api = makeApi();

/* ── Home ── */
export function Home({ backup, onBackupNow, onOpenSettings, onResumeProgress, onOpenHistory, onOpenProject }: {
  backup: BackupProgress;
  onBackupNow: () => void;
  onOpenSettings: () => void;
  onResumeProgress: () => void;
  onOpenHistory: () => void;
  onOpenProject: (name: string) => void;
}) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [err, setErr] = useState(false);
  const [kick, setKick] = useState(false);        // scanning before the backup starts
  const [doneFlash, setDoneFlash] = useState(false);
  const [fixing, setFixing] = useState<Set<string>>(new Set());
  const [look] = useLook();

  const load = () => {
    api.overview().then(setOv).catch(() => setErr(true));
    api.library().then((r) => setItems(r.projects)).catch(() => {});
  };
  useEffect(load, [backup.done]);
  useEffect(() => {  // pool size is computed in the background the first time
    if (ov && !ov.pool_known) {
      const t = setTimeout(() => api.overview().then(setOv).catch(() => {}), 3000);
      return () => clearTimeout(t);
    }
  }, [ov]);

  // backup run state machine: idle → working → done (5.2s) → idle
  const working = kick || backup.active;
  const prevActive = useRef(false);
  useEffect(() => {
    if (prevActive.current && !backup.active && backup.done && !backup.cancelled) {
      setDoneFlash(true);
      const t = setTimeout(() => setDoneFlash(false), 5200);
      return () => clearTimeout(t);
    }
    prevActive.current = backup.active;
  }, [backup.active, backup.done, backup.cancelled]);

  // the ONE primary action: scan + back everything up, in place, with real progress
  async function backItUp() {
    if (working) return;
    setKick(true);
    try {
      const r = await api.scanMac("sources", true);
      const paths = r.projects.map((p) => p.als_path);
      if (paths.length === 0) { onBackupNow(); return; }  // nothing found → guided flow
      await api.startBackup({ als_paths: paths, find_missing: true, portable: true, layout: "project_date" });
    } catch {
      onBackupNow();  // quick path failed → fall back to the guided flow
    } finally {
      setKick(false);
    }
  }

  // "Find it for me": re-back up that one project with sample-hunting on. An
  // optional extraLib is a folder the user pointed at ("look in this folder"),
  // searched this run in addition to the saved sample libraries.
  async function fixOne(it: LibraryItem, extraLib?: string) {
    setFixing((s) => new Set(s).add(it.project_id));
    try {
      const { job_id } = await api.startBackup({
        als_paths: [it.path], find_missing: true, portable: true, layout: "project_date",
        libraries: extraLib ? [extraLib] : undefined,
      });
      for (;;) {
        const st = await api.jobStatus(job_id);
        if (st.state === "done" || st.state === "error") break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch { /* result shows on reload */ }
    finally {
      setFixing((s) => { const n = new Set(s); n.delete(it.project_id); return n; });
      load();
    }
  }

  // "Look in a folder": pick a folder you think the samples are in, then hunt there.
  async function lookInFolder(it: LibraryItem) {
    const dir = await (window as any).ablebackup?.pickFolder?.();
    if (dir) fixOne(it, dir);
  }

  if (err) return <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>Couldn't reach the backup service.</div>;
  if (!ov) return <p className="sub">Waking the sloth…</p>;

  const verified = items.filter((i) => i.backed_up).length;
  const waiting = items.length - verified;
  const warnItems = items.filter((i) => i.missing_count > 0);
  // One "needs a look" number everywhere: projects missing samples (backed up or not)
  // plus any whose last backup failed.
  const warnNames = new Set(warnItems.map((i) => i.name));
  const lookCount = warnItems.length
    + new Set(ov.attention.filter((a) => a.kind === "error" && !warnNames.has(a.project_name)).map((a) => a.project_name)).size;
  const savedPct = ov.logical_size > 0 ? Math.round((ov.saved_bytes / ov.logical_size) * 100) : 0;
  const okCount = items.filter((i) => i.backed_up && i.missing_count === 0).length;
  const lookItems = items.filter((i) => i.missing_count > 0);
  const newCount = items.filter((i) => !i.backed_up && i.missing_count === 0).length;
  const failed = ov.attention.filter((a) => a.kind === "error" && !warnNames.has(a.project_name));

  // Plain facts, one headline. The numbers are real, never vague.
  const title = doneFlash
    ? (backup.errors > 0 ? `Backed up ${backup.completed}, ${backup.errors} failed.` : `Backed up and checked ${backup.completed} ${backup.completed === 1 ? "project" : "projects"}.`)
    : working ? (kick && !backup.active ? "Looking for projects…" : `Backing up ${backup.completed} of ${backup.total || "…"}…`)
    : items.length === 0 ? "Let's find your projects."
    : `${verified} of ${items.length} projects are safe.`;
  const sub = working
    ? (backup.current ? `Now: ${backup.current}. Every file is read back and the copy is opened to prove it works.` : "Every file is read back and the copy is opened to prove it works.")
    : items.length === 0
    ? "Press the button and Backups will look through your project folders."
    : lookCount > 0
    ? `Every backed-up project was re-opened and loads. ${lookCount} ${lookCount === 1 ? "needs" : "need"} a look below.`
    : "Every backed-up project was re-opened and loads without errors.";
  const eyebrow = ov.last_run
    ? `Last backup ${fmtDate(ov.last_run)} · ${ov.schedule.enabled
        ? `next ${ov.schedule.next_run ? fmtClock(ov.schedule.next_run) : fmtInterval(ov.schedule.interval_minutes)}`
        : "next: when you say so"}`
    : "No backups yet";
  const pct = backup.total > 0 ? Math.round((backup.completed / backup.total) * 100) : 0;
  const total = okCount + lookItems.length + newCount;
  const spaceSaved = ov.pool_known ? fmtSize(ov.saved_bytes) + (savedPct > 0 ? ` · ${savedPct}%` : "") : "…";
  const meta = (it: LibraryItem): SongMeta | undefined =>
    it.latest_export ? { title: it.latest_export.name, project: it.name, genre: it.genre } : undefined;
  const subLine = (it: LibraryItem) => [it.genre, it.bpm ? `${Math.round(it.bpm)} BPM` : "", dawLabel(it.daw)].filter(Boolean).join(" · ");
  const recent = [...items].sort((a, b) => b.mtime - a.mtime).slice(0, 6);
  const songs = items.filter((i) => i.latest_export).sort((a, b) => b.latest_export!.mtime - a.latest_export!.mtime).slice(0, 6);
  const byName = new Map(items.map((i) => [i.name, i]));

  const head = (
    <>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="sub">{sub}{" "}
          {working && backup.active && <button className="linkbtn" onClick={onResumeProgress}>Show details</button>}
        </p>
      </div>
      <div className="page-head__actions">
        {look === "crate" && !ov.schedule.enabled && <button className="btn" onClick={onOpenSettings}>Set a schedule</button>}
        <button className="btn btn--primary" onClick={backItUp} disabled={working || !ov.nas.reachable}
          title={ov.nas.reachable ? "Find every project and back it up, checked" : "Choose where backups go in Settings first"}>
          {working ? "Backing up…" : waiting > 0 ? `Back up ${waiting} ${waiting === 1 ? "project" : "projects"}` : "Back up now"}
        </button>
        {look === "sleeve" && !ov.schedule.enabled && <button className="btn" onClick={onOpenSettings}>Set a schedule</button>}
      </div>
    </>
  );
  const progress = working && (
    <div className="progress" style={{ marginBottom: 22 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__fill" style={{ width: `${Math.max(3, pct)}%` }} />
    </div>
  );
  const fixButtons = (it: LibraryItem, label: string) => {
    const busy = fixing.has(it.project_id);
    return (
      <span className="col-act" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn--sm" onClick={() => fixOne(it)} disabled={busy}>{busy ? "Searching…" : label}</button>
        <button className="iconbtn" onClick={() => lookInFolder(it)} disabled={busy}
          title="Search a folder you choose" aria-label={`Search a folder for ${it.name}'s samples`}>
          <Icon name="folder" />
        </button>
      </span>
    );
  };
  const needsHead = (
    <div className="section__head">
      <h2>Needs a look</h2>
      <button className="linkbtn" onClick={onOpenHistory}>Open the library</button>
    </div>
  );
  const hasNeeds = lookItems.length > 0 || failed.length > 0;

  const foot = (
    <footer className="home-foot">
      <span title={ov.nas.path} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span className={`dot${ov.nas.reachable ? " dot--ok" : " dot--error"}`} />
        {ov.nas.reachable ? "Backup drive connected" : "Backup drive not found"}
        {ov.nas.path ? <span className="faint mono" style={{ fontSize: 12 }}>{shortPath(ov.nas.path)}</span> : null}
      </span>
      <span className="mono faint" style={{ fontSize: 12 }}>
        {ov.pool_known ? `${fmtSize(ov.actual_size)} used · ${fmtSize(ov.nas.free_bytes)} free` : ""}
      </span>
      <span className="faint" style={{ fontSize: 12.5 }}>
        {ov.schedule.enabled
          ? `Automatic backup ${fmtInterval(ov.schedule.interval_minutes)}`
          : <>Automatic backup off. <button className="linkbtn" onClick={onOpenSettings}>Set a schedule</button></>}
      </span>
    </footer>
  );

  if (look === "sleeve") return (
    <div className="home home--sleeve">
      <header className="home-hero">
        <div className="home-hero__text">{head}</div>
        {items.length > 0 && (
          <div className="home-hero__bar" aria-label="Where your projects stand">
            <div className="statusbar statusbar--fat" aria-hidden="true">
              {okCount > 0 && <span style={{ flex: okCount, background: "var(--accent-2)" }} />}
              {lookItems.length > 0 && <span style={{ flex: lookItems.length, background: "var(--warn)" }} />}
              {newCount > 0 && <span style={{ flex: newCount, background: "var(--idle)" }} />}
            </div>
            <div className="home-hero__legend">
              <button className="linkbtn" onClick={onOpenHistory}><b>{okCount}</b> safe</button>
              <button className="linkbtn" onClick={onOpenHistory}><b>{lookCount}</b> need a look</button>
              <button className="linkbtn" onClick={onOpenHistory}><b>{waiting}</b> not yet</button>
            </div>
            <div className="home-hero__saved">Space saved by sharing files <span className="mono">{spaceSaved}</span></div>
          </div>
        )}
      </header>
      {progress}

      {recent.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Recently worked on</h2>
            <button className="linkbtn" onClick={onOpenHistory}>Open the library</button>
          </div>
          <div className="recent-shelf">
            {recent.map((it) => {
              const m = meta(it);
              return (
                <div key={it.project_id} className="sleeve" role="button" tabIndex={0} onClick={() => onOpenProject(it.name)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenProject(it.name); } }}>
                  <div className="sleeve__art">
                    <Cover name={it.name} genre={it.genre} />
                    {it.latest_export && m &&
                      <PlayButton path={it.latest_export.path} title={it.latest_export.name} meta={m} size={34} className="sleeve__play" />}
                  </div>
                  <div className="sleeve__meta">
                    <div className="sleeve__name" title={it.name}>{it.name}</div>
                    <div className="sleeve__sub">{subLine(it) || "No genre yet"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {hasNeeds && (
        <section className="section">
          {needsHead}
          <div className="needcards">
            {lookItems.map((it) => (
              <div key={it.project_id} className="needcard" role="button" tabIndex={0} onClick={() => onOpenProject(it.name)}
                onKeyDown={(e) => { if (e.key === "Enter") onOpenProject(it.name); }}>
                <Cover name={it.name} genre={it.genre} label={false} />
                <div className="needcard__body">
                  <div className="sleeve__name" title={it.name}>{it.name}</div>
                  <div className="warn-line"><span className="dot dot--warn" />{it.missing_count} {it.missing_count === 1 ? "sample" : "samples"} missing</div>
                  {fixButtons(it, "Find them")}
                </div>
              </div>
            ))}
            {failed.map((a) => {
              const it = byName.get(a.project_name);
              return (
                <div key={"f" + a.project_name} className="needcard" role="button" tabIndex={0} onClick={() => onOpenProject(a.project_name)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpenProject(a.project_name); }}>
                  <Cover name={a.project_name} genre={it?.genre} label={false} />
                  <div className="needcard__body">
                    <div className="sleeve__name" title={a.project_name}>{a.project_name}</div>
                    <div className="warn-line warn-line--error" title={a.reason}><span className="dot dot--error" />{a.reason}</div>
                    <span className="col-act"><button className="btn btn--sm">Open</button></span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {foot}

    </div>
  );

  // Crate: a ring of where things stand, the list of what needs a look, latest songs as waveforms
  const R = 70, C = 2 * Math.PI * R;
  const arcs = [
    { n: okCount, color: "var(--accent-2)" },
    { n: lookItems.length, color: "var(--warn)" },
    { n: newCount, color: "var(--idle)" },
  ];
  let at = 0;
  return (
    <div className="home home--crate">
      <header className="page-head">{head}</header>
      {progress}

      {items.length > 0 && (
        <div className="home-deck">
          <section className="ringcard" aria-label="Where your projects stand">
            <svg viewBox="0 0 180 180" width="180" height="180" className="ring" aria-hidden="true">
              <circle cx="90" cy="90" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="16" />
              {total > 0 && arcs.map((a, i) => {
                if (!a.n) return null;
                const len = (a.n / total) * C;
                const gap = arcs.filter((x) => x.n).length > 1 ? 3 : 0;
                const el = <circle key={i} cx="90" cy="90" r={R} fill="none" stroke={a.color} strokeWidth="16"
                  strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-at} transform="rotate(-90 90 90)" />;
                at += len;
                return el;
              })}
              <text x="90" y="92" textAnchor="middle" className="ring__big">{verified}</text>
              <text x="90" y="116" textAnchor="middle" className="ring__small">of {items.length} safe</text>
            </svg>
            <div className="ring__legend">
              <button className="ring__row" onClick={onOpenHistory}><span className="dot dot--ok" />Backed up, opens<b>{okCount}</b></button>
              <button className="ring__row" onClick={onOpenHistory}><span className="dot dot--warn" />Need a look<b>{lookCount}</b></button>
              <button className="ring__row" onClick={onOpenHistory}><span className="dot" />Not backed up<b>{waiting}</b></button>
              <div className="ring__row ring__row--quiet">Space saved by sharing files<b>{spaceSaved}</b></div>
            </div>
          </section>

          <div className="home-deck__main">
            <section className="section">
              {needsHead}
              {hasNeeds ? (
                <div className="table table--crate">
                  {lookItems.map((it) => (
                    <div key={it.project_id} className="row cols needs-cols" role="button" tabIndex={0}
                      onClick={() => onOpenProject(it.name)} onKeyDown={(e) => { if (e.key === "Enter") onOpenProject(it.name); }}>
                      <span className="stripe" style={{ background: genreColor(it.genre) }} />
                      <Cover name={it.name} genre={it.genre} size={36} />
                      <span style={{ minWidth: 0 }}>
                        <div className="col-trunc" style={{ fontWeight: 500 }}>{it.name}</div>
                        <div className="lib-sub">{subLine(it)}</div>
                      </span>
                      <span className="warn-line"><span className="dot dot--warn" />{it.missing_count} {it.missing_count === 1 ? "sample" : "samples"} missing</span>
                      {fixButtons(it, "Find samples")}
                    </div>
                  ))}
                  {failed.map((a) => {
                    const it = byName.get(a.project_name);
                    return (
                      <div key={"f" + a.project_name} className="row cols needs-cols" role="button" tabIndex={0}
                        onClick={() => onOpenProject(a.project_name)} onKeyDown={(e) => { if (e.key === "Enter") onOpenProject(a.project_name); }}>
                        <span className="stripe" style={{ background: "var(--danger)" }} />
                        <Cover name={a.project_name} genre={it?.genre} size={36} />
                        <span className="col-trunc" style={{ fontWeight: 500 }}>{a.project_name}</span>
                        <span className="warn-line warn-line--error" title={a.reason}><span className="dot dot--error" />{a.reason}</span>
                        <span className="col-act"><button className="btn btn--sm">Open</button></span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="allgood"><span className="dot dot--ok" />Nothing needs a look. Every backed-up project opens.</div>
              )}
            </section>

            {songs.length > 0 && (
              <section className="section">
                <div className="section__head"><h2>Latest songs from your projects</h2></div>
                <div className="songgrid">
                  {songs.map((it) => {
                    const m = meta(it)!;
                    return (
                      <div key={it.project_id} className="songcell">
                        <PlayButton path={it.latest_export!.path} title={it.latest_export!.name} meta={m} size={30} />
                        <div style={{ minWidth: 0 }}>
                          <div className="songcell__top">
                            <button className="linkbtn col-trunc" onClick={() => onOpenProject(it.name)}>{it.name}</button>
                            <span className="mono faint">{it.bpm ? `${Math.round(it.bpm)} BPM` : ""}</span>
                          </div>
                          <SongWave path={it.latest_export!.path} meta={m} height={22} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {foot}
    </div>
  );
}
