import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { pickCover } from "../components/CoverPick";
import { lastLibrary, makeApi } from "../api";
import type { Overview, LibraryItem } from "../types";
import { runDoneCount, runDoneTitle, runPct, type BackupProgress } from "../useProgress";
import { countStatuses, itemStatus, yearOf, type LibFilters, type StatusFilter } from "../libraryFilter";
import { Collection, tally, type CollectionData } from "../components/Collection";
import { rowKey } from "../components/a11y";
import { backupAndWait } from "../runBackup";
import { Exit, openMenu, toast, toastWarn } from "../components/Desktop";
import { copyText } from "../desktop";
import { osWords } from "../platform";
import { fmtSize, fmtDate, fmtInterval, fmtNext, shortPath, dawLabel, fmtCount, fmtCap, openWord, stemsOnly } from "../format";
import { Icon } from "../components/Icon";
import { Cover } from "../components/Cover";
import { Rolling } from "../components/Rolling";
import { PlayButton, SongWave, type SongMeta } from "../components/Player";
import { genreColor, useLook } from "../look";
import { togglePin, usePins } from "../pins";
import { EmptyState, SlothSpot } from "../components/SlothSpot";
import { DoneSeal } from "../components/DoneSeal";
import { useFlip } from "../glide";
import { announce, reached, type Milestone } from "../milestones";
import { onThisDay } from "../onThisDay";
import "../home.css";
import "../label.css";  // the printed numbers (.proj-spec), shared with the project page

const api = makeApi();
const bridge = () => (window as any).ablebackup;
const HOME_ROWS = 8;  // rows per Home list before "Show all"

/* ── Home ── */
export function Home({ backup, onBackupNow, onFindProjects, onOpenSettings, onResumeProgress, onOpenHistory, onOpenStatus, onOpenFilters, onOpenProject }: {
  backup: BackupProgress;
  onBackupNow: () => void;
  onFindProjects: () => void;  // look through the project folders, then browse them in the Library
  onOpenSettings: () => void;
  onResumeProgress: () => void;
  onOpenHistory: () => void;
  onOpenStatus: (status: StatusFilter) => void;  // the Library showing only these
  onOpenFilters: (f: Partial<LibFilters>) => void;  // the Library showing one genre, app or year
  onOpenProject: (name: string) => void;
}) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [items, setItems] = useState<LibraryItem[]>(() => lastLibrary()?.projects ?? []);
  const [err, setErr] = useState(false);
  const [kick, setKick] = useState(false);
  const [spineAt, setSpineAt] = useState(0);  // the shelf spine that Tab lands on        // scanning before the backup starts
  const [doneFlash, setDoneFlash] = useState(false);
  const [barHold, setBarHold] = useState(false);  // the bar stays full a moment after a run, then fades
  const [fixing, setFixing] = useState<Set<string>>(new Set());
  // A Changed card backed up from here says "Safe" for a moment, then glides out of the
  // list while the others close up. settled: its phase ("safe", then "out" as it leaves).
  const [settled, setSettled] = useState<Record<string, "safe" | "out">>({});
  const [allSafe, setAllSafe] = useState(false);  // the last change just went: the sloth says so
  const changedBox = useRef<HTMLDivElement | null>(null);
  const noteFlip = useFlip(changedBox);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const [mile, setMile] = useState<Milestone | null>(null);  // a milestone reached just now (said once)
  const [driveBack, setDriveBack] = useState(false);         // the backup drive was just plugged back in
  const [look] = useLook();
  const pins = usePins();

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

  // The first time the Safe count reaches 100, 250, 500 or 1,000, one line says so (once).
  const safeNow = items.length ? countStatuses(items).safe : 0;
  useEffect(() => {
    const m = announce(safeNow);
    if (m) setMile(m);
  }, [safeNow]);
  // The last Changed card glided out: "All safe. Back to my nap."
  const realChanged = items.filter((i) => itemStatus(i) === "changed").length;
  const settledCount = Object.keys(settled).length;
  const hadChanged = useRef(false);
  useEffect(() => {
    if (realChanged > 0 || settledCount > 0) { hadChanged.current = true; setAllSafe(false); return; }
    if (hadChanged.current && settledCount === 0) setAllSafe(true);
  }, [realChanged, settledCount]);

  // While the backup drive can't be found, look for it every few seconds; when it comes
  // back, its dot rings once and a note says so (the Back up button wakes up too).
  const missingDrive = !!ov?.nas.path && !ov.nas.reachable;
  // A NAS Backups connects itself can be asleep: Back up still works, it wakes it first.
  const canBackUp = !!ov && (ov.nas.reachable || !!ov.nas.nas_name);
  const backTitle = (what: string) => ov?.nas.reachable ? what
    : ov?.nas.nas_name ? `Your NAS isn't connected right now. Backups will connect it first, giving it a minute to wake up.`
    : "Your backup drive isn't connected. Plug it in and try again.";
  useEffect(() => {
    if (!missingDrive) return;
    const t = window.setInterval(() => {
      api.overview().then((o) => {
        if (!o.nas.reachable) return;
        setOv(o);
        setDriveBack(true);
        toast("Your backup drive is back.");
        timers.current.push(window.setTimeout(() => setDriveBack(false), 1600));
      }).catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [missingDrive]);

  // backup run state machine: idle → working → done (5.2s) → idle
  const working = kick || backup.active;
  const prevActive = useRef(false);
  useEffect(() => {
    if (prevActive.current && !backup.active && backup.done && !backup.cancelled) {
      setDoneFlash(true);
      setBarHold(true);
      const t = setTimeout(() => setDoneFlash(false), 5200);
      const h = setTimeout(() => setBarHold(false), 1400);
      return () => { clearTimeout(t); clearTimeout(h); setBarHold(false); };
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
    } catch (e: any) {
      // The drive went away: say so (the guided flow would only hit the same wall).
      if (/backup drive isn't connected/i.test(e?.message || "")) { toastWarn(e.message); load(); return; }
      onBackupNow();  // quick path failed → fall back to the guided flow
    } finally {
      setKick(false);
    }
  }

  // "Find missing samples": re-back up that one project with sample-hunting on. An
  // optional extraLib is a folder the user pointed at ("look in this folder"),
  // searched this run in addition to the saved sample libraries.
  // If it doesn't work, a message says why and offers to try again; if samples are
  // still missing afterwards, it offers the project page to point to them.
  function settle(id: string) {
    setSettled((s) => ({ ...s, [id]: "safe" }));
    timers.current.push(window.setTimeout(() => setSettled((s) => (s[id] ? { ...s, [id]: "out" } : s)), 1500));
    timers.current.push(window.setTimeout(() => {
      noteFlip();
      setSettled((s) => { const n = { ...s }; delete n[id]; return n; });
    }, 1500 + 400));
  }
  async function fixOne(it: LibraryItem, extraLib?: string) {
    const wasChanged = itemStatus(it) === "changed";
    setFixing((s) => new Set(s).add(it.project_id));
    const res = await backupAndWait({
      als_paths: [it.path], find_missing: true, portable: true, layout: "project_date",
      libraries: extraLib ? [extraLib] : undefined,
    });
    setFixing((s) => { const n = new Set(s); n.delete(it.project_id); return n; });
    load();
    if (res.ok && wasChanged) settle(it.project_id);
    if (!res.ok) {
      toastWarn(`${it.name} couldn't be backed up. ${res.reason}`, { label: "Try again", onClick: () => { fixOne(it, extraLib); } });
      return;
    }
    if (it.missing_count > 0) {
      const now = (await api.library().catch(() => null))?.projects.find((i) => i.project_id === it.project_id);
      if (now && now.missing_count > 0) {
        toastWarn(`${now.missing_count} of ${it.name}'s samples are still missing.`,
          { label: "Point to them", onClick: () => onOpenProject(it.name) });
      } else if (now) toast(`Found every missing sample in ${it.name} and backed it up.`);
    }
  }

  // "Look in a folder": pick a folder you think the samples are in, then hunt there.
  async function lookInFolder(it: LibraryItem) {
    const dir = await (window as any).ablebackup?.pickFolder?.();
    if (dir) fixOne(it, dir);
  }

  if (err) return (
    <EmptyState pose="tangled" title="Backups lost touch with its engine"
      action={<button className="btn btn--primary" onClick={() => (window as any).ablebackup?.relaunch?.()}>Restart the app</button>}>
      The part of the app that does the backing up stopped answering. Restarting the app usually fixes it; your backups are safe.
    </EmptyState>
  );
  if (!ov) return <p className="sub">Waking the sloth…</p>;

  // Saved in the DAW since its last backup: backed up, but not this version.
  // The same counting as the Library and Dig (itemStatus), so the numbers agree.
  const counts = countStatuses(items);
  const changedItems = items.filter((i) => itemStatus(i) === "changed");
  const notYet = counts.none;
  const warnItems = items.filter((i) => i.missing_count > 0);
  // One "needs a look" number everywhere: projects missing samples (backed up or not)
  // plus any whose last backup failed.
  const warnNames = new Set(warnItems.map((i) => i.name));
  const lookCount = warnItems.length
    + new Set(ov.attention.filter((a) => a.kind === "error" && !warnNames.has(a.project_name)).map((a) => a.project_name)).size;
  const savedPct = ov.logical_size > 0 ? Math.round((ov.saved_bytes / ov.logical_size) * 100) : 0;
  const okCount = counts.safe;
  const lookItems = items.filter((i) => itemStatus(i) === "missing");
  const newCount = counts.none;
  const failed = ov.attention.filter((a) => a.kind === "error" && !warnNames.has(a.project_name));
  // The big button scans and backs up the project folders from Settings, so its
  // number counts only the projects in those folders (a whole-computer Library scan
  // can hold many more). Same "not yet" + "changed" counting as everywhere else.
  const inFolders = items.filter((i) => i.in_folders !== false);
  const folderNew = inFolders.filter((i) => itemStatus(i) === "none").length;
  const folderWaiting = folderNew + inFolders.filter((i) => itemStatus(i) === "changed").length;
  // Nothing found yet: lead with finding and browsing. Backing up stays one click away.
  const firstFind = items.length === 0 && !working && !doneFlash;

  // No backup folder yet: the person skipped backups to just browse.
  const off = !ov.nas.path;
  // Plain facts, one headline. The numbers are real, never vague.
  const title = off
    ? (items.length === 0 ? "Let's find your projects." : `${fmtCount(items.length)} ${items.length === 1 ? "project" : "projects"}, ready to browse.`)
    : doneFlash
    ? runDoneTitle(backup)
    : working ? (kick && !backup.active ? "Looking for projects…" : `Backing up ${runDoneCount(backup)} of ${backup.total || "…"}…`)
    : items.length === 0 ? "Let's find your projects."
    : `${fmtCount(okCount)} of ${fmtCount(items.length)} projects are safe.`;
  const sub = off
    ? (items.length === 0
      ? "Backups looks through your project folders and lays every project out to browse. Turn backups on whenever you like."
      : "Backups are off for now. Turn them on whenever you like and every project gets a checked copy.")
    : working
    ? (backup.current ? `Now: ${backup.current}. Every file is read back and the copy is opened to prove it works.` : "Every file is read back and the copy is opened to prove it works.")
    : items.length === 0
    ? "Backups looks through your project folders and lays every project out to browse. Backing up is one click away."
    : lookCount > 0 || changedItems.length > 0
    ? `Every backed-up project was re-opened and loads. ${[
        changedItems.length > 0 ? `${fmtCount(changedItems.length)} changed since ${changedItems.length === 1 ? "its" : "their"} last backup` : "",
        lookCount > 0 ? `${fmtCount(lookCount)} ${lookCount === 1 ? "needs" : "need"} a look` : "",
      ].filter(Boolean).join(", ")} below.`
    : "Every backed-up project was re-opened and loads without errors.";
  const schedLine = off ? "Backups off" : ov.last_run
    ? `Last backup ${fmtDate(ov.last_run).replace(/^(Today|Yesterday)\b/, (w) => w.toLowerCase())} · ${ov.schedule.enabled
        ? `next ${ov.schedule.next_run ? fmtNext(ov.schedule.next_run) : fmtInterval(ov.schedule.interval_minutes)}`
        : "next: when you say so"}`
    : "No backups yet";
  // The bar counts every project the run has dealt with (backed up, already safe or failed),
  // like the Backup screen. When the run ends it holds full for a moment, then fades out.
  const pct = !working ? 100 : backup.active ? runPct(backup) : 0;
  const total = counts.all;
  const spaceSaved = ov.pool_known ? fmtSize(ov.saved_bytes) + (savedPct > 0 ? ` · ${savedPct}%` : "") : "…";
  const meta = (it: LibraryItem): SongMeta | undefined =>
    it.latest_export ? { title: it.latest_export.name, project: it.name, projectId: it.project_id, genre: it.genre } : undefined;
  const subLine = (it: LibraryItem) => [it.genre, it.bpm ? `${Math.round(it.bpm)} BPM` : "", dawLabel(it.daw)].filter(Boolean).join(" · ");
  // Pinned projects first (in pin order), then the most recently saved, six in all.
  const pinnedItems = pins.map((id) => items.find((i) => i.project_id === id)).filter((i): i is LibraryItem => !!i);
  const recent = [...pinnedItems, ...[...items].filter((i) => !pins.includes(i.project_id)).sort((a, b) => b.mtime - a.mtime)]
    .slice(0, Math.max(6, pinnedItems.length));
  const recentTitle = pinnedItems.length ? "Pinned and recently worked on" : "Recently worked on";
  // Crate's list under the two above leaves out what they already show (pins stay)
  const shown = new Set([...changedItems, ...lookItems].map((i) => i.project_id));
  const recentRows = [...pinnedItems, ...[...items].filter((i) => !pins.includes(i.project_id) && !shown.has(i.project_id)).sort((a, b) => b.mtime - a.mtime)];
  const savedWhen = (it: LibraryItem) => {
    const d = new Date(it.mtime * 1000), p2 = (n: number) => String(n).padStart(2, "0");
    return fmtDate(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`);
  };
  const songs = items.filter((i) => i.latest_export).sort((a, b) => b.latest_export!.mtime - a.latest_export!.mtime).slice(0, 6);
  const byName = new Map(items.map((i) => [i.name, i]));

  const head = (
    <>
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        <p className="sub">{sub}{" "}
          {working && backup.active && <button className="linkbtn" onClick={onResumeProgress}>Show details</button>}
        </p>
        <p className="statusline"><Icon name="history" size={13} />{schedLine}</p>
      </div>
      <div className="page-head__actions">
        {off ? (items.length === 0 ? <>
          <button className="btn" onClick={onOpenSettings}>Turn on backups</button>
          <button className="btn btn--primary" onClick={onFindProjects}>Find my projects</button>
        </> : <>
          <button className="btn" onClick={onOpenHistory}>Browse the library</button>
          <button className="btn btn--primary" onClick={onOpenSettings}>Turn on backups</button>
        </>) : firstFind ? <>
          <button className="btn" onClick={backItUp} disabled={!canBackUp}
            title={backTitle("Find every project, back it up and check each copy")}>Back up now</button>
          <button className="btn btn--primary" onClick={onFindProjects}>Find my projects</button>
        </> : <>
        {look === "crate" && !ov.schedule.enabled && <button className="btn" onClick={onOpenSettings}>Set a schedule</button>}
        <button className="btn btn--primary" onClick={backItUp} disabled={working || !canBackUp}
          title={backTitle("Find every project in your folders, back it up and check each copy")}>
          {working ? "Backing up…"
            : folderWaiting > 0 && folderNew === 0 ? `Back up the ${fmtCount(folderWaiting)} changed`
            : folderWaiting > 0 ? `Back up ${fmtCount(folderWaiting)} ${folderWaiting === 1 ? "project" : "projects"}` : "Back up now"}
        </button>
        {look === "sleeve" && !ov.schedule.enabled && <button className="btn" onClick={onOpenSettings}>Set a schedule</button>}
        </>}
      </div>
    </>
  );
  const progress = (
    <Exit>{(working || barHold) && (
      <div className="progress" style={{ marginBottom: 22 }} role="progressbar" aria-label="Backing up" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress__fill" style={{ "--pct": Math.max(3, pct) } as CSSProperties} />
      </div>
    )}</Exit>
  );
  const fixButtons = (it: LibraryItem, label: string) => {
    const busy = fixing.has(it.project_id);
    return (
      <span className="col-act" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn--sm" onClick={() => fixOne(it)} disabled={busy}
          title="Search your sample folders for them and back the project up">{busy ? "Searching…" : label}</button>
        <button className="iconbtn" onClick={() => lookInFolder(it)} disabled={busy}
          title="Search a folder you choose" aria-label={`Search a folder for ${it.name}'s samples`}>
          <Icon name="folder" />
        </button>
      </span>
    );
  };
  // right-click on a project anywhere on Home: the same everyday actions as the library
  const projectMenu = (it: LibraryItem) => (e: React.MouseEvent) => openMenu(e, [
    { label: "Show backups & details", onClick: () => onOpenProject(it.name) },
    { label: openWord(it.daw), onClick: () => { if (it.path) bridge()?.[stemsOnly(it.daw) ? "revealPath" : "openProject"]?.(it.path); } },
    { label: it.backed_up && !it.changed ? "Back up again" : "Back up now", onClick: () => { fixOne(it); }, disabled: fixing.has(it.project_id) },
    { label: pins.includes(it.project_id) ? "Unpin" : "Pin to the top", onClick: () => togglePin(it.project_id) },
    { label: "Change cover…", onClick: () => { pickCover({ title: it.name, name: it.name, genre: it.genre }); } },
    "-",
    { label: `Show in ${osWords().fileManager}`, onClick: () => { if (it.path) bridge()?.revealPath?.(it.path); } },
    { label: "Copy project path", onClick: () => { copyText(it.path); } },
  ]);
  const backupButton = (it: LibraryItem) => {
    const busy = fixing.has(it.project_id);
    return (
      <span className="col-act" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn--sm" onClick={() => fixOne(it)} disabled={busy}>{busy ? "Backing up…" : "Back up"}</button>
      </span>
    );
  };
  // "Needs a look" counts exactly the rows under it (missing samples and failed
  // backups); changed projects have their own list with their own count.
  const lookRows = lookItems.length + failed.length;
  const needsHead = (
    <div className="section__head">
      <h2>Needs a look{lookRows > 0 && <span className="faint section__n"> {fmtCount(lookRows)}</span>}</h2>
    </div>
  );
  const changedHead = (
    <div className="section__head">
      <h2>Changed since last backup<span className="faint section__n"> {fmtCount(changedItems.length)}</span></h2>
    </div>
  );
  // The Changed list also keeps the ones just backed up from here while they say "Safe"
  // and glide out (settled); the counts above are the real ones.
  const changedList = items.filter((i) => itemStatus(i) === "changed" || settled[i.project_id]);
  const hasNeeds = changedList.length > 0 || lookItems.length > 0 || failed.length > 0;
  // Big libraries can have hundreds waiting: Home shows the first few of each list
  // and hands the rest to the Library, filtered to them.
  const changedShown = changedList.slice(0, HOME_ROWS);
  const lookShown = lookItems.slice(0, HOME_ROWS);
  const failedShown = failed.slice(0, Math.max(0, HOME_ROWS - lookShown.length));
  const more = (total: number, shown: number, status: StatusFilter) => total > shown && (
    <button className="linkbtn home-more" onClick={() => onOpenStatus(status)}>Show all {fmtCount(total)} in the Library</button>
  );
  const changedMore = more(changedItems.length, changedShown.filter((i) => !settled[i.project_id]).length, "changed");
  const lookMore = more(lookRows, lookShown.length + failedShown.length, "missing");
  const edited = (it: LibraryItem) => {
    return `Saved ${savedWhen(it)}, after its last backup`;
  };

  const collection = items.length > 0 ? <Collection data={collectionOf(items, onOpenFilters)} /> : null;

  // A Changed card or row that was just backed up: "Safe" with the small seal, then out.
  const settledClass = (it: LibraryItem) => settled[it.project_id] === "out" ? " home-out" : "";
  const safeLine = <span className="warn-line warn-line--safe" role="status"><DoneSeal />Safe</span>;
  // The last change went: the sloth's line, for this visit.
  const allSafeLine = allSafe && changedItems.length === 0 && (
    <div className="allgood allgood--in" role="status"><SlothSpot pose="thumbs-up" size={40} />
      <span><b>Every change is backed up.</b></span><span className="allgood__say">All safe. Back to my nap.</span></div>
  );
  // Gold, platinum or diamond, by the Safe count (milestones.ts), pressed in when just reached.
  const tier = reached(okCount);
  const disc = tier && (
    <span className={`mdisc mdisc--${tier.tier}${mile?.at === tier.at ? " mdisc--new" : ""}`} role="img" aria-label={tier.title} title={tier.title} />
  );
  const mileLine = mile && (
    <p className="home-mile" role="status"><span className={`mdisc mdisc--${mile.tier} mdisc--new`} aria-hidden="true" />{mile.line}</p>
  );
  // "On this day": a project last saved on today's date in an earlier year (onThisDay.ts).
  const otd = onThisDay(items);
  const otdLine = otd && (
    <button type="button" className="otd" onClick={() => onOpenProject(otd.item.name)} onContextMenu={projectMenu(otd.item)}
      data-nav-key={otd.item.name} aria-label={`On this day in ${otd.year} you last saved ${otd.item.name}. Open it`}>
      <Cover name={otd.item.name} genre={otd.item.genre} size={36} label={false} />
      <span className="otd__text">
        <span className="otd__when">On this day in {otd.year}, last saved</span>
        <span className="otd__name" title={otd.item.name}>{otd.item.name}</span>
      </span>
      <Icon name="chevronRight" size={14} />
    </button>
  );

  const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const foot = (
    <footer className="home-foot">
      <span title={ov.nas.path} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span className={`dot${off ? "" : ov.nas.reachable ? " dot--ok" : ov.nas.nas_name ? " dot--warn" : " dot--error"}${driveBack ? " dot--back" : ""}`} />
        {off ? <>Backups off. <button className="linkbtn" onClick={onOpenSettings}>Choose where they go</button></>
          : ov.nas.nas_name ? (ov.nas.reachable ? "NAS connected"
            : ov.nas.retry_at ? `NAS asleep. Trying again at ${fmtClock(ov.nas.retry_at)}` : "NAS asleep. It's connected when a backup starts")
          : ov.nas.reachable ? "Backup drive connected" : "Backup drive not found"}
        {ov.nas.path ? <span className="faint mono" style={{ fontSize: 12 }}>{shortPath(ov.nas.path)}</span> : null}
      </span>
      <span className="mono faint" style={{ fontSize: 12 }}>
        {ov.pool_known ? `${fmtSize(ov.actual_size)} used${ov.nas.reachable ? ` · ${fmtSize(ov.nas.free_bytes)} free` : ""}` : ""}
      </span>
      <span className="faint" style={{ fontSize: 12 }}>
        {ov.schedule.enabled
          ? `Automatic backup ${fmtInterval(ov.schedule.interval_minutes)}`
          : <>Automatic backup off. <button className="linkbtn" onClick={onOpenSettings}>Set a schedule</button></>}
      </span>
    </footer>
  );

  if (look === "sleeve") return (
    <div className="home home--sleeve">
      {/* the page's own head, then where the projects stand printed big, split by
          hairlines, like the numbers on a project's page (no dashboard panel) */}
      <header className="page-head">{head}</header>
      {items.length > 0 && (
        <div className="home-print">
          <dl className="proj-spec home-spec" aria-label="Where your projects stand">
            <div><dt><span className="dot dot--ok" />Safe{disc}</dt>
              <dd><button className="home-spec__n" onClick={() => onOpenStatus("safe")} aria-label={`${fmtCount(okCount)} safe: show them`}><Rolling value={okCount} /></button></dd></div>
            {changedItems.length > 0 && <div><dt><span className="dot dot--accent" />Changed</dt>
              <dd><button className="home-spec__n" onClick={() => onOpenStatus("changed")} aria-label={`${fmtCount(changedItems.length)} changed: show them`}><Rolling value={changedItems.length} /></button></dd></div>}
            <div><dt><span className="dot dot--warn" />Need a look</dt>
              <dd><button className="home-spec__n" onClick={() => onOpenStatus("missing")} aria-label={`${fmtCount(lookCount)} need a look: show them`}><Rolling value={lookCount} /></button></dd></div>
            <div><dt><span className="dot" />Not backed up</dt>
              <dd><button className="home-spec__n" onClick={() => onOpenStatus("none")} aria-label={`${fmtCount(notYet)} not backed up: show them`}><Rolling value={notYet} /></button></dd></div>
          </dl>
          <p className="home-print__saved">Space saved by not copying twice <span className="mono">{spaceSaved}</span></p>
        </div>
      )}
      {mileLine}
      {progress}
      {otdLine}

      {recent.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>{recentTitle}</h2>
            <button className="linkbtn" onClick={onOpenHistory}>Open the library</button>
          </div>
          <div className="recent-shelf">
            {recent.map((it) => {
              const m = meta(it);
              return (
                <div key={it.project_id} className="sleeve" data-nav-key={it.name} onClick={() => onOpenProject(it.name)} onContextMenu={projectMenu(it)}>
                  <div className="sleeve__art">
                    <Cover name={it.name} genre={it.genre} />
                    {pins.includes(it.project_id) && <span className="pin-badge" title="Pinned"><Icon name="starFilled" size={13} /></span>}
                    {it.latest_export && m &&
                      <PlayButton path={it.latest_export.path} title={it.latest_export.name} meta={m} size={34} className="sleeve__play" />}
                  </div>
                  <div className="sleeve__meta">
                    <button type="button" className="rowopen"><span className="sleeve__name" title={it.name}>{it.name}</span></button>
                    <div className="sleeve__sub">{subLine(it) || "No genre yet"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {changedList.length > 0 ? (
        <section className="section">
          {changedHead}
          <div className="needcards" ref={changedBox}>
            {changedShown.map((it) => (
              <div key={"c" + it.project_id} className={`needcard${settledClass(it)}`} data-nav-key={it.name} data-flip={it.project_id}
                onClick={() => onOpenProject(it.name)} onContextMenu={projectMenu(it)}>
                <Cover name={it.name} genre={it.genre} label={false} />
                <div className="needcard__body">
                  <button type="button" className="rowopen"><span className="sleeve__name" title={it.name}>{it.name}</span></button>
                  {settled[it.project_id] ? safeLine : <>
                    <div className="warn-line warn-line--changed" title={edited(it)}><span className="dot dot--accent" />Changed</div>
                    {backupButton(it)}
                  </>}
                </div>
              </div>
            ))}
          </div>
          {changedMore}
        </section>
      ) : allSafeLine && <section className="section">{allSafeLine}</section>}
      {lookRows > 0 && (
        <section className="section">
          {needsHead}
          <div className="needcards">
            {lookShown.map((it) => (
              <div key={it.project_id} className="needcard" data-nav-key={it.name} onClick={() => onOpenProject(it.name)} onContextMenu={projectMenu(it)}>
                <Cover name={it.name} genre={it.genre} label={false} />
                <div className="needcard__body">
                  <button type="button" className="rowopen"><span className="sleeve__name" title={it.name}>{it.name}</span></button>
                  <div className="warn-line"><span className="dot dot--warn" />{fmtCap(it.missing_count)} {it.missing_count === 1 ? "sample" : "samples"} missing</div>
                  {fixButtons(it, "Find missing samples")}
                </div>
              </div>
            ))}
            {failedShown.map((a) => {
              const it = byName.get(a.project_name);
              return (
                <div key={"f" + a.project_name} className="needcard" data-nav-key={a.project_name} onClick={() => onOpenProject(a.project_name)}>
                  <Cover name={a.project_name} genre={it?.genre} label={false} />
                  <div className="needcard__body">
                    <div className="sleeve__name" title={a.project_name}>{a.project_name}</div>
                    <div className="warn-line warn-line--error" title={a.reason}><span className="dot dot--error" />{a.reason}</div>
                    <span className="col-act"><button type="button" className="btn btn--sm" aria-label={`Open ${a.project_name}`}>Open</button></span>
                  </div>
                </div>
              );
            })}
          </div>
          {lookMore}
        </section>
      )}

      {collection}
      {foot}

    </div>
  );

  // Crate: a shelf of record spines (one per project, coloured by where it stands) under a
  // deck-style readout, the list of what needs a look, latest songs as waveforms
  type Spine = { names: string[]; tone: "ok" | "changed" | "look" | "new" };
  const ordered: Spine[] = [
    ...items.filter((i) => i.backed_up && !i.changed && i.missing_count === 0).map((i) => ({ names: [i.name], tone: "ok" as const })),
    ...changedItems.map((i) => ({ names: [i.name], tone: "changed" as const })),
    ...lookItems.map((i) => ({ names: [i.name], tone: "look" as const })),
    ...items.filter((i) => !i.backed_up && i.missing_count === 0).map((i) => ({ names: [i.name], tone: "new" as const })),
  ];
  // Big libraries: one spine stands for a few projects of the same kind so the shelf still fits.
  const per = Math.max(1, Math.ceil(ordered.length / 72));
  const spines: Spine[] = [];
  for (const sp of ordered) {
    const last = spines[spines.length - 1];
    if (last && last.tone === sp.tone && last.names.length < per) last.names.push(sp.names[0]);
    else spines.push({ names: [...sp.names], tone: sp.tone });
  }
  // One Tab stop for the whole shelf; the arrow keys walk along it (Home and End jump to the ends).
  const spineKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = spines.length - 1;
    const at = Math.min(spineAt, last);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(last, at + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? Math.max(0, at - 1)
      : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    setSpineAt(to);
    e.currentTarget.querySelector<HTMLElement>(`[data-spine="${to}"]`)?.focus();
  };
  const toneWord = { ok: "safe", changed: "saved since its last backup", look: "missing samples", new: "not backed up yet" };
  return (
    <div className="home home--crate">
      <header className="page-head">{head}</header>
      {mileLine}
      {progress}

      {items.length > 0 && (
        <div className="home-deck">
          <section className="deckcard" aria-label="Where your projects stand">
            <div className="deckcard__screen">
              <span className="deckcard__lbl">Safe{disc}</span>
              <span className={`deckcard__big${total >= 1000 ? " deckcard__big--long" : ""}`}><Rolling value={okCount} /><small>/<Rolling value={total} /></small></span>
              <span className="deckcard__lbl deckcard__lbl--r">{changedItems.length + lookCount > 0 ? `${fmtCount(changedItems.length + lookCount)} to do` : "All good"}</span>
            </div>
            <div className={`spines${spines.length > 40 ? " spines--tight" : ""}`} role="group"
              aria-label="One line per project. Left and right arrows move along" onKeyDown={spineKey}>
              {spines.map((sp, i) => (
                <button key={i} type="button" className={`spine spine--${sp.tone}`} data-spine={i}
                  tabIndex={i === Math.min(spineAt, spines.length - 1) ? 0 : -1} onFocus={() => setSpineAt(i)}
                  title={sp.names.length === 1 ? `${sp.names[0]}: ${toneWord[sp.tone]}` : `${sp.names.length} projects ${toneWord[sp.tone]}`}
                  aria-label={sp.names.length === 1 ? `${sp.names[0]}, ${toneWord[sp.tone]}` : `${sp.names.length} projects ${toneWord[sp.tone]}`}
                  onClick={() => sp.names.length === 1 ? onOpenProject(sp.names[0]) : onOpenHistory()} />
              ))}
            </div>
            <div className="deckcard__legend">
              <button className="deckcard__row" onClick={onOpenHistory}><span className="dot dot--ok" />Backed up, opens<b>{fmtCount(okCount)}</b></button>
              {changedItems.length > 0 && <button className="deckcard__row" onClick={onOpenHistory}><span className="dot dot--accent" />Changed since last backup<b>{fmtCount(changedItems.length)}</b></button>}
              <button className="deckcard__row" onClick={onOpenHistory}><span className="dot dot--warn" />Need a look<b>{fmtCount(lookCount)}</b></button>
              <button className="deckcard__row" onClick={onOpenHistory}><span className="dot" />Not backed up<b>{fmtCount(notYet)}</b></button>
              <div className="deckcard__row deckcard__row--quiet">Space saved by not copying twice<b>{spaceSaved}</b></div>
            </div>
          </section>

          <div className="home-deck__main">
            <section className="section">
              {hasNeeds ? (<>
                {changedList.length > 0 ? <>{changedHead}<div className="table table--crate" ref={changedBox}>
                  {changedShown.map((it) => (
                    <div key={"c" + it.project_id} data-nav-key={it.name} data-flip={it.project_id} className={`row cols needs-cols${settledClass(it)}`}
                      onClick={() => onOpenProject(it.name)} onContextMenu={projectMenu(it)}>
                      <span className="stripe" style={{ background: genreColor(it.genre) }} />
                      <Cover name={it.name} genre={it.genre} size={36} />
                      <span style={{ minWidth: 0 }}>
                        <button type="button" className="rowopen"><span className="col-trunc" style={{ fontWeight: 500 }} title={it.name}>{it.name}</span></button>
                        <div className="lib-sub">{subLine(it)}</div>
                      </span>
                      {settled[it.project_id] ? <>{safeLine}<span className="col-act" /></> : <>
                        <span className="warn-line warn-line--changed" title={edited(it)}><span className="dot dot--accent" />Changed</span>
                        {backupButton(it)}
                      </>}
                    </div>
                  ))}
                </div>{changedMore}</> : allSafeLine && <div style={{ marginBottom: 22 }}>{allSafeLine}</div>}
                {lookRows > 0 && <div style={changedList.length > 0 ? { marginTop: 22 } : undefined}>{needsHead}<div className="table table--crate">
                  {lookShown.map((it) => (
                    <div key={it.project_id} data-nav-key={it.name} className="row cols needs-cols"
                      onClick={() => onOpenProject(it.name)} onContextMenu={projectMenu(it)}>
                      <span className="stripe" style={{ background: genreColor(it.genre) }} />
                      <Cover name={it.name} genre={it.genre} size={36} />
                      <span style={{ minWidth: 0 }}>
                        <button type="button" className="rowopen"><span className="col-trunc" style={{ fontWeight: 500 }} title={it.name}>{it.name}</span></button>
                        <div className="lib-sub">{subLine(it)}</div>
                      </span>
                      <span className="warn-line" title={`${fmtCount(it.missing_count)} ${it.missing_count === 1 ? "sample" : "samples"} missing`}><span className="dot dot--warn" />{fmtCap(it.missing_count)} {it.missing_count === 1 ? "sample" : "samples"} missing</span>
                      {fixButtons(it, "Find missing samples")}
                    </div>
                  ))}
                  {failedShown.map((a) => {
                    const it = byName.get(a.project_name);
                    return (
                      <div key={"f" + a.project_name} data-nav-key={a.project_name} className="row cols needs-cols"
                        onClick={() => onOpenProject(a.project_name)}>
                        <span className="stripe" style={{ background: "var(--danger)" }} />
                        <Cover name={a.project_name} genre={it?.genre} size={36} />
                        <span className="col-trunc" style={{ fontWeight: 500 }} title={a.project_name}>{a.project_name}</span>
                        <span className="warn-line warn-line--error" title={a.reason}><span className="dot dot--error" />{a.reason}</span>
                        <span className="col-act"><button type="button" className="btn btn--sm" aria-label={`Open ${a.project_name}`}>Open</button></span>
                      </div>
                    );
                  })}
                </div>{lookMore}</div>}
              </>) : (<>{needsHead}
                <div className="allgood"><SlothSpot pose="thumbs-up" size={40} /><span><b>Nothing needs a look.</b> Every backed-up project opens.</span><span className="allgood__say">All safe. Back to my nap.</span></div>
              </>)}
            </section>

            {otdLine}
            {recentRows.length > 0 && (
              <section className="section">
                <div className="section__head">
                  <h2>{recentTitle}</h2>
                  <button className="linkbtn" onClick={onOpenHistory}>Open the library</button>
                </div>
                <div className="table table--crate">
                  {recentRows.slice(0, pinnedItems.length > 4 ? pinnedItems.length : 4).map((it) => {
                    const pinned = pins.includes(it.project_id);
                    const st = it.missing_count > 0 ? ["dot--warn", `${fmtCap(it.missing_count)} missing`]
                      : it.changed ? ["dot--accent", "Changed"] : it.backed_up ? ["dot--ok", "Safe"] : ["", "Not backed up"];
                    return (
                      <div key={"r" + it.project_id} data-nav-key={it.name} className="row cols recent-cols" role="button" tabIndex={0}
                        onClick={() => onOpenProject(it.name)} onContextMenu={projectMenu(it)} onKeyDown={rowKey(() => onOpenProject(it.name))}>
                        <span className="stripe" style={{ background: genreColor(it.genre) }} />
                        <Cover name={it.name} genre={it.genre} size={36} />
                        <span style={{ minWidth: 0 }}>
                          <div className="recent-name" style={{ fontWeight: 500 }}>
                            {pinned && <span className="recent-star" title="Pinned"><Icon name="starFilled" size={12} /></span>}<span className="col-trunc" title={it.name}>{it.name}</span>
                          </div>
                          <div className="lib-sub">{subLine(it)}</div>
                        </span>
                        <span className="mono faint recent-when">{savedWhen(it)}</span>
                        <span className="recent-state"><span className={`dot ${st[0]}`} />{st[1]}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {songs.length > 0 && (
              <section className="section">
                <div className="section__head"><h2>Latest songs from your projects</h2></div>
                <div className="songgrid">
                  {songs.map((it) => {
                    const m = meta(it)!;
                    return (
                      <div key={it.project_id} className="songcell" data-nav-key={it.name} onContextMenu={projectMenu(it)}>
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

      {collection}
      {foot}
    </div>
  );
}

// The whole library in figures, for "Your collection" / the liner notes.
function collectionOf(items: LibraryItem[], open: (f: Partial<LibFilters>) => void): CollectionData {
  const c = countStatuses(items);
  const songs = items.reduce((n, i) => n + (i.export_count ?? (i.latest_export ? 1 : 0)), 0);
  const online = items.filter((i) => i.latest_export?.uploaded).length;
  const size = items.reduce((n, i) => n + (i.size || 0), 0);
  const kept = items.reduce((n, i) => n + (i.snapshot_count || 0), 0);
  const backed = items.filter((i) => i.backed_up).length;
  const genres = tally(items, (i) => i.genre);
  const daws = tally(items, (i) => i.daw);
  const years = tally(items, yearOf).sort((a, b) => b[0].localeCompare(a[0]));
  const first = years.length ? years[years.length - 1][0] : "";
  const top = genres.slice(0, 2).map(([g]) => g);
  return {
    intro: `${fmtCount(items.length)} project${items.length === 1 ? "" : "s"}${first && years.length > 1 ? `, saved between ${first} and ${years[0][0]}` : ""}`
      + `${top.length ? `, mostly ${top.join(" and ")}` : ""}. ${fmtCount(c.safe)} of them are safe right now.`,
    figures: [
      { label: "Projects", value: fmtCount(items.length) },
      { label: "Backed up", value: fmtCount(backed), note: backed < items.length ? `${fmtCount(items.length - backed)} not yet` : "every one" },
      { label: "Songs exported", value: fmtCount(songs) },
      { label: "On SoundCloud", value: fmtCount(online) },
      { label: "Size on disk", value: fmtSize(size) },
      { label: "Backups kept", value: fmtCount(kept) },
    ],
    lists: [
      { title: "Genres", rows: genres.map(([g, n]) => ({ label: g, n, colour: genreColor(g), onClick: () => open({ genre: g }) })) },
      { title: "DAWs", rows: daws.map(([d, n]) => ({ label: dawLabel(d), n, onClick: () => open({ daw: d }) })) },
      { title: "Year last saved", rows: years.map(([y, n]) => ({ label: y, n, onClick: () => open({ year: y }) })) },
    ],
  };
}
