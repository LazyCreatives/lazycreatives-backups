import { useEffect, useRef, useState, type ReactNode } from "react";
import { CopyButton, openMenu, toast } from "../components/Desktop";
import { baseName, copyText } from "../desktop";
import { makeApi } from "../api";
import type { Config, Overview } from "../types";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { Info } from "../components/Info";
import { PlanCard } from "../components/PlanCard";
import { ProBadge } from "../components/ProBadge";
import { Icon, type IconName } from "../components/Icon";
import { SlothSpot } from "../components/SlothSpot";
import { Cover } from "../components/Cover";
import { CoverShelf } from "../components/CoverShelf";
import { genreColor, useLook } from "../look";
import { GlyphPicker } from "../components/Marks";
import { ThemePicker } from "../components/LookPicker";
import { UpdateCheck } from "../components/UpdateCheck";
import { useEntitlement } from "../entitlement";
import { fmtInterval, fmtClock, fmtSize } from "../format";
import { osWords } from "../platform";
import { useCloudFolders } from "../components/DestChoices";

const api = makeApi();

const PRESETS = [
  { label: "Off", min: 0 },
  { label: "Hourly", min: 60 },
  { label: "Every 6h", min: 360 },
  { label: "Daily", min: 1440 },
  { label: "Weekly", min: 10080 },
];

export function Sources() {
  const [look, setLook] = useLook();
  const [cfg, setCfg] = useState<Config>({ sources: [], dest: "", interval_minutes: 0, libraries: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [nextRun, setNextRun] = useState<string | null>(null);
  const [rclone, setRclone] = useState<{ available: boolean; remotes: string[] }>({ available: false, remotes: [] });
  const [providers, setProviders] = useState<{ key: string; label: string }[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);  // provider key in progress
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  // a real project to show the cover pictures on (Settings, Covers)
  const [coverSample, setCoverSample] = useState<{ name: string; genre?: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    api.library().then((l) => {
      const p = l.projects.find((x) => x.genre) ?? l.projects[0];
      if (alive && p) setCoverSample({ name: p.name, genre: p.genre });
    }).catch(() => { /* the shelf shows a stand-in name */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => { api.overview().then(setOv).catch(() => {}); }, [cfg.dest]);  // null = unknown (dev page)
  const { allows, beta } = useEntitlement();
  const words = osWords();
  const canSchedule = allows("scheduled");
  const canCloud = allows("cloud_backup");
  const cloud = useCloudFolders();

  function refreshNextRun() {
    api.overview().then((o) => setNextRun(o.schedule.next_run ?? null)).catch(() => {});
  }
  function load() {
    setLoadError(false);
    api.getSettings()
      .then((c) => { lastSaved.current = JSON.stringify(c); setCfg(c); setLoaded(true); })
      .catch(() => setLoadError(true));
  }
  useEffect(() => {
    load(); refreshNextRun();
    api.rclone().then(setRclone).catch(() => {});
    api.cloudProviders().then(setProviders).catch(() => {});
    (window as any).ablebackup?.getOpenAtLogin?.().then(setOpenAtLogin).catch(() => {});
  }, []);

  async function toggleOpenAtLogin(on: boolean) {
    const b = (window as any).ablebackup;
    if (!b?.setOpenAtLogin) return;
    try { setOpenAtLogin(await b.setOpenAtLogin(on)); }
    catch { setSaveError(`Couldn't change whether the app starts with your ${words.computer}.`); }
  }

  async function addSource() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir && !cfg.sources.includes(dir)) setCfg({ ...cfg, sources: [...cfg.sources, dir] });
  }
  const libraries = cfg.libraries ?? [];
  async function addLibrary() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir && !libraries.includes(dir)) setCfg({ ...cfg, libraries: [...libraries, dir] });
  }
  function removeLibrary(l: string) {
    setCfg((c) => ({ ...c, libraries: (c.libraries ?? []).filter((x) => x !== l) }));
    toast(`Removed ${baseName(l)} from your sample folders.`, { label: "Undo",
      onClick: () => setCfg((c) => ({ ...c, libraries: [...(c.libraries ?? []).filter((x) => x !== l), l] })) });
  }
  async function pickDest() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir) setCfg({ ...cfg, dest: dir });
  }
  const mirrors = cfg.mirrors ?? [];
  async function addMirror() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir && dir !== cfg.dest && !mirrors.includes(dir)) setCfg({ ...cfg, mirrors: [...mirrors, dir] });
  }
  function removeMirror(m: string) {
    setCfg((c) => ({ ...c, mirrors: (c.mirrors ?? []).filter((x) => x !== m) }));
    toast(`Stopped copying backups to ${baseName(m)}.`, { label: "Undo",
      onClick: () => setCfg((c) => ({ ...c, mirrors: [...(c.mirrors ?? []).filter((x) => x !== m), m] })) });
  }
  function addRemote(name: string) {
    const dest = `${name}:LazyCreatives-Backups`;
    setCfg((c) => {
      const ms = c.mirrors ?? [];
      return ms.includes(dest) ? c : { ...c, mirrors: [...ms, dest] };
    });
  }
  async function connectCloud(provider: string, label: string) {
    setConnectErr(null); setConnectMsg(null); setConnecting(provider);
    try {
      const r = await api.cloudConnect(provider);
      if (r.auth_url) {
        (window as any).ablebackup.openExternal(r.auth_url);
        setConnectMsg(`A browser opened — sign in to ${label} and allow access, then come back here.`);
      } else {
        setConnectMsg("Finishing up…");
      }
      pollConnect(r.connect_id, label);
    } catch (e: any) {
      setConnecting(null);
      setConnectErr(e.message || `Couldn't start ${label} sign-in.`);
    }
  }
  function pollConnect(id: string, label: string, tries = 0) {
    window.setTimeout(async () => {
      try {
        const s = await api.cloudConnectStatus(id);
        if (s.status === "connected") {
          setConnecting(null);
          setConnectMsg(`Connected. Every backup will also copy to ${s.remote}.`);
          addRemote(s.remote);
          api.rclone().then(setRclone).catch(() => {});
        } else if (s.status === "failed") {
          setConnecting(null);
          setConnectErr(s.error || `${label} sign-in didn't complete.`);
        } else if (tries < 200) {  // ~5 min at 1.5s/poll
          pollConnect(id, label, tries + 1);
        } else {
          setConnecting(null);
          setConnectErr(`Timed out waiting for ${label} sign-in.`);
        }
      } catch {
        if (tries < 200) pollConnect(id, label, tries + 1);
        else { setConnecting(null); setConnectErr("Lost contact while connecting."); }
      }
    }, 1500);
  }
  function removeSource(s: string) {
    setCfg((c) => ({ ...c, sources: c.sources.filter((x) => x !== s) }));
    toast(`Removed ${baseName(s)} from your project folders.`, { label: "Undo",
      onClick: () => setCfg((c) => ({ ...c, sources: [...c.sources.filter((x) => x !== s), s] })) });
  }

  // Changes save by themselves a moment after you make them; no Save button to forget.
  const lastSaved = useRef<string>("");
  const savedTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!loaded) return;  // never overwrite stored settings with an un-loaded default
    const body = { ...cfg, interval_minutes: Math.max(0, cfg.interval_minutes) };
    const json = JSON.stringify(body);
    if (json === lastSaved.current) return;
    const t = window.setTimeout(async () => {
      setSaveError(null);
      try {
        const next = await api.saveSettings(body);
        lastSaved.current = JSON.stringify(next);
        setCfg((c) => (JSON.stringify(c) === json ? next : c));  // keep newer edits made meanwhile
        setSaved(true);
        window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setSaved(false), 1800);
        refreshNextRun();
      } catch (e: any) {
        setSaveError(e.message ? `Couldn't save that change: ${e.message}` : "Couldn't save that change. Try again.");
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [cfg, loaded]);

  if (loadError) {
    return (
      <>
        <PageHeader title="Settings" subtitle="Where to find your projects, and where to keep the backups." />
        <div className="card">
          <strong style={{ color: "var(--danger)" }}>Couldn't reach the backup service.</strong>
          <p className="sub" style={{ margin: "8px 0 14px" }}>Settings weren't loaded — saving is disabled so your stored config isn't overwritten.</p>
          <Button variant="ghost" onClick={load}>Retry</Button>
        </div>
      </>
    );
  }

  return (
    <div className="settings">
      <PageHeader
        title="Settings"
        subtitle="Where to find your projects, and where to keep the backups."
        actions={saved
          ? <span className="pill pill--ok" role="status">Saved</span>
          : <span className="faint settings-autosave">Changes save by themselves</span>}
      />

      {saveError && <div className="banner banner--warn"><Icon name="alert" className="banner__icon" />{saveError}</div>}

      {!beta && <PlanCard />}

      <SetGroup title="How it looks" />
      <SetRow title="Look" help="How the app is laid out. Switch any time; nothing else changes.">
        <div className="lookpick" role="group" aria-label="Look">
          {([["crate", "Crate", "Rows like a DJ library, with waveforms and genre stripes"],
             ["sleeve", "Sleeve", "Cover art first, like an album shelf"]] as const).map(([k, name, what]) => (
            <button key={k} type="button" className="lookpick__opt" aria-pressed={look === k} onClick={() => setLook(k)}>
              <LookThumb kind={k} />
              <span><strong style={{ fontWeight: 600 }}>{name}</strong><br /><small>{what}</small></span>
            </button>
          ))}
        </div>
      </SetRow>
      <SetRow title="Light or dark" help="Ink or paper, in either look. Match my computer follows your computer's own setting.">
        <ThemePicker />
      </SetRow>
      <SetRow title="Rating mark" help="What ratings are drawn with. Rate a project from its row, or right-click it.">
        <GlyphPicker />
      </SetRow>

      <SetGroup title="Covers" />
      <SetRow title="Your pictures"
        help="Put your own pictures on project covers: behind the drawing, or as the whole cover. Change one project from its page or by right-clicking it.">
        <CoverShelf sample={coverSample?.name ?? "Your project"} sampleGenre={coverSample?.genre} />
      </SetRow>

      <SetGroup title="Your music" />
      <SetRow title="Project folders" help="Backups looks in these folders for your projects.">
        <FolderTable paths={cfg.sources} loaded={loaded} empty="No folders yet." onRemove={removeSource} />
        <Button variant="ghost" size="sm" onClick={addSource} disabled={!loaded}><Icon name="plus" size={14} />Add folder</Button>
      </SetRow>

      <SetRow title="Sample folders"
        help={<>Where your samples live, so missing ones can be found and relinked. Your <code>~/Splice</code> folder is always searched.</>}
        info="When a project is missing samples, the finder searches these folders (plus your project folders) for a file of the same name and relinks it. Point it at wherever your samples live: Splice, a packs drive, an old project archive.">
        <FolderTable paths={libraries} loaded={loaded} empty="No extra folders. Splice is still searched." onRemove={removeLibrary} />
        <Button variant="ghost" size="sm" onClick={addLibrary} disabled={!loaded}><Icon name="plus" size={14} />Add a sample folder</Button>
      </SetRow>

      <SetGroup title="Where backups go" />
      <SetRow title="Backup drive" help="The folder where backups are kept: your own drive or NAS, or a Dropbox or Google Drive folder. You own every copy.">
        <div className="drive">
          {cfg.dest ? <Icon name="disc" size={22} className="drive__icon" /> : <SlothSpot pose="hugging-drive" size={56} />}
          <div className="drive__main">
            <span className="pathline">
              <span className="mono col-trunc drive__path" title={cfg.dest}>{cfg.dest || "No folder chosen yet"}</span>
              {cfg.dest && <CopyButton text={cfg.dest} what="folder path" size={13} />}
            </span>
            {ov && ov.nas.total_bytes > 0 ? (
              <>
                <div className="drive__bar" aria-hidden>
                  <span className="drive__other" style={{ width: `${pct(ov.nas.total_bytes - ov.nas.free_bytes - ov.actual_size, ov.nas.total_bytes)}%` }} />
                  <span className="drive__ours" style={{ width: `${pct(ov.actual_size, ov.nas.total_bytes)}%` }} />
                </div>
                <span className="faint drive__nums">
                  <span className="drive__key" />Backups {fmtSize(ov.actual_size)} · {fmtSize(ov.nas.free_bytes)} free of {fmtSize(ov.nas.total_bytes)}
                </span>
              </>
            ) : (
              <span className="faint drive__nums">{cfg.dest ? (ov && !ov.nas.reachable ? "Can't reach this folder right now" : "Folder set") : "Pick a NAS folder, external drive, or any folder"}</span>
            )}
          </div>
          <Button variant="ghost" onClick={pickDest} disabled={!loaded}>{cfg.dest ? "Change…" : "Choose…"}</Button>
        </div>
        {cloud.folders.some((f) => f.path) && (
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
            <span className="faint" style={{ fontSize: 12.5 }}>Or use</span>
            {cloud.folders.filter((f) => f.path).map((f) => {
              const d = cloud.destFor(f.path!);
              return <button key={f.key} className={`chip${cfg.dest === d ? " chip--on" : ""}`} disabled={!loaded}
                onClick={() => setCfg({ ...cfg, dest: d })}>{f.label}</button>;
            })}
          </div>
        )}
      </SetRow>

      <SetRow title={<>Second copy{!canCloud && <ProBadge label="STUDIO" />}</>}
        help="Every backup is also copied here, such as a Dropbox, Google Drive or iCloud folder, so the work survives if the drive dies."
        info="Also copy every backup to a second place: a cloud-synced folder (Dropbox, Google Drive, iCloud, OneDrive) or another drive. That's the offsite copy in the 3-2-1 rule.">
        {canCloud ? (
          <>
            <FolderTable paths={mirrors} loaded={loaded} empty="No second copy yet." onRemove={removeMirror} icon="link" />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="ghost" size="sm" onClick={addMirror} disabled={!loaded}><Icon name="plus" size={14} />Add a folder</Button>
              {providers.map((p) => (
                <Button key={p.key} variant="ghost" size="sm" onClick={() => connectCloud(p.key, p.label)}
                  disabled={!rclone.available || connecting !== null}>
                  {connecting === p.key ? `Waiting for ${p.label} sign-in…` : `Connect ${p.label}`}
                </Button>
              ))}
            </div>
            {connectMsg && <div className="sub" style={{ color: "var(--accent-2)", margin: 0, fontSize: 12.5 }}>{connectMsg}</div>}
            {connectErr && <div className="sub" style={{ color: "var(--danger)", margin: 0, fontSize: 12.5 }}>{connectErr}</div>}
            {rclone.available && rclone.remotes.length > 0 && (
              <div>
                <div className="faint" style={{ margin: "0 0 7px", fontSize: 12.5 }}>Cloud accounts already set up on this {words.computer}</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {rclone.remotes.map((r) => (
                    <button key={r} className="chip" onClick={() => addRemote(r)}
                      disabled={mirrors.includes(`${r}:LazyCreatives-Backups`)}>+ {r}</button>
                  ))}
                </div>
              </div>
            )}
            {!rclone.available && (
              <div className="faint" style={{ fontSize: 12.5 }}>
                The cloud sign-in buttons need the free <strong style={{ color: "var(--text-dim)" }}>rclone</strong> tool. Adding a synced folder works without it.
              </div>
            )}
          </>
        ) : (
          <div className="locked-note">
            <Icon name="lock" size={14} /> Copy every backup to your cloud or a second drive. A <strong style={{ color: "var(--text)" }}>Studio</strong> feature.
          </div>
        )}
      </SetRow>

      <SetGroup title="When it runs" />
      <SetRow title={<>Automatic backup{!canSchedule && <ProBadge />}</>}
        help={`Leave the app running (it lives in your ${words.tray}) and it backs up on its own.`}>
        <div className={`seg${canSchedule ? "" : " locked"}`} role="group" style={{ flexWrap: "wrap", alignSelf: "flex-start" }}>
          {PRESETS.map((p) => (
            <button key={p.min} disabled={!loaded || !canSchedule}
              className={`seg__opt${cfg.interval_minutes === p.min ? " seg__opt--on" : ""}`}
              onClick={() => setCfg({ ...cfg, interval_minutes: p.min })}>{p.label}</button>
          ))}
        </div>
        {canSchedule ? (
          cfg.interval_minutes > 0
            ? <span className="pill pill--ok">On, backs up {fmtInterval(cfg.interval_minutes)}{nextRun ? `, next ${fmtClock(nextRun)}` : ""}</span>
            : <span className="pill pill--skipped">Off, you back up when you choose</span>
        ) : (
          <div className="locked-note"><Icon name="lock" size={14} /> Automatic backups are a <strong style={{ color: "var(--text)" }}>Pro</strong> feature.</div>
        )}
      </SetRow>

      {openAtLogin !== null && (
        <SetRow title={`Start with your ${words.computer}`}
          help="Opens Backups when you log in, so automatic backups keep running.">
          <div className="seg" role="group" style={{ alignSelf: "flex-start" }}>
            <button className={`seg__opt${openAtLogin ? " seg__opt--on" : ""}`} onClick={() => toggleOpenAtLogin(true)}>On</button>
            <button className={`seg__opt${!openAtLogin ? " seg__opt--on" : ""}`} onClick={() => toggleOpenAtLogin(false)}>Off</button>
          </div>
          {!openAtLogin && cfg.interval_minutes > 0 &&
            <span className="faint" style={{ fontSize: 12.5 }}>Automatic backups only run while the app is open.</span>}
        </SetRow>
      )}

      <SetGroup title="About" />
      <SetRow title="What it does" help="Lazy Creatives · Looks lazy. Works obsessively.">
        <p className="set-about">Backups lays out every music project on this computer to browse, with the songs you exported from each. Turn backups on and it keeps checked copies too. It only reads your projects; it never changes them.</p>
      </SetRow>
      <SetRow title="Updates" help="The app checks for a new version on its own. Press the button to check right now.">
        <UpdateCheck />
      </SetRow>
    </div>
  );
}

// A heading over a few settings rows.
function SetGroup({ title }: { title: string }) {
  return <h2 className="set-group">{title}</h2>;
}

const pct = (v: number, of: number) => Math.max(0, Math.min(100, of > 0 ? (v / of) * 100 : 0));

// One settings section: its name and a short line on the left, its controls on the right.
function SetRow({ title, help, info, children }: { title: ReactNode; help?: ReactNode; info?: string; children: ReactNode }) {
  return (
    <section className="set-row">
      <div className="set-row__label">
        <h2>{title}{info && <Info text={info} />}</h2>
        {help && <p>{help}</p>}
      </div>
      <div className="set-row__body">{children}</div>
    </section>
  );
}

// Folders as one fixed-column list, the same in every section.
function FolderTable({ paths, loaded, empty, onRemove, icon = "folder" }: {
  paths: string[]; loaded: boolean; empty: string; onRemove: (p: string) => void; icon?: IconName;
}) {
  if (paths.length === 0) return <p className="faint" style={{ margin: 0, fontSize: 13 }}>{loaded ? empty : "Loading…"}</p>;
  return (
    <div className="table folder-cols">
      {paths.map((p) => (
        <div key={p} className="row cols">
          <Icon name={icon} size={15} className="faint" />
          <span className="pathline" onContextMenu={(e) => openMenu(e, [
            { label: `Show in ${osWords().fileManager}`, onClick: () => (window as any).ablebackup?.revealPath?.(p) },
            { label: "Copy folder path", onClick: () => { copyText(p); } },
            "-", { label: "Remove", onClick: () => onRemove(p), danger: true },
          ])}>
            <span className="mono col-trunc" style={{ fontSize: 12.5, color: "var(--text-dim)" }} title={p}>{p}</span>
            <CopyButton text={p} what="folder path" size={13} />
          </span>
          <span className="col-act"><Button variant="quiet" size="sm" onClick={() => onRemove(p)}>Remove</Button></span>
        </div>
      ))}
    </div>
  );
}

// A tiny drawing of each look for the switch.
function LookThumb({ kind }: { kind: "crate" | "sleeve" }) {
  const demo = [["Grime riddim 140", "Grime"], ["DNB roller", "DnB"], ["Garage sunday", "UK garage"], ["Lo-fi rain", "Lo-fi"]];
  if (kind === "sleeve") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
        {demo.map(([n, g]) => <Cover key={n} name={n} genre={g} label={false} className="lookpick__cover" />)}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 3 }}>
      {demo.slice(0, 3).map(([n, g], i) => (
        <div key={n} style={{ display: "grid", gridTemplateColumns: "3px 14px 1fr", gap: 6, alignItems: "center",
          height: 16, background: i % 2 ? "var(--zebra-solid)" : "transparent" }}>
          <span style={{ background: genreColor(g), alignSelf: "stretch" }} />
          <Cover name={n} genre={g} size={14} label={false} />
          <span style={{ height: 4, borderRadius: 2, background: genreColor(g), opacity: 0.6, width: `${60 + i * 12}%` }} />
        </div>
      ))}
    </div>
  );
}
