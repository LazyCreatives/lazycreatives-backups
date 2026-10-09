import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { CopyButton, askConfirm, openMenu, toast } from "../components/Desktop";
import { PAUSE_ON_MINIMIZE, baseName, copyText, keep, pausesOnMinimize } from "../desktop";
import { makeApi, type PhoneCode, type PhoneStatus } from "../api";
import type { Config, Overview } from "../types";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { Choice, OnOff, SetPanel, SetRow, SetTabs, useSettingsTab } from "../components/SetRow";
import { PlanCard } from "../components/PlanCard";
import { ProBadge } from "../components/ProBadge";
import { Icon, type IconName } from "../components/Icon";
import { SlothSpot } from "../components/SlothSpot";
import { Cover } from "../components/Cover";
import { CoverShelf } from "../components/CoverShelf";
import { genreColor, useLook } from "../look";
import { GlyphPicker } from "../components/Marks";
import { ThemePicker } from "../components/LookPicker";
import { ReadingSettings } from "../components/ReadingSettings";
import { fadeSwitch } from "../fade";
import { UpdateCheck } from "../components/UpdateCheck";
import { useEntitlement } from "../entitlement";
import { fmtCount, fmtInterval, fmtNext, fmtDay, fmtSize } from "../format";
import { osWords } from "../platform";
import { useCloudFolders } from "../components/DestChoices";
import { EXPORT_FOLDER_FROM, exportFolderRows } from "../exportFolders";

const api = makeApi();

const PRESETS = [[0, "Off"], [60, "Hourly"], [360, "Every 6 hours"], [1440, "Daily"], [10080, "Weekly"]] as const;

// The Phone tab is held back from releases while the phone app is tested: it shows
// in development, or after localStorage "lc-phone" is set to "1".
const SHOW_PHONE = import.meta.env.DEV || (() => { try { return localStorage.getItem("lc-phone") === "1"; } catch { return false; } })();
const ALL_TABS = [["folders", "Folders"], ["backups", "Backups"], ["look", "Look"], ["privacy", "Privacy"], ["phone", "Phone"], ["app", "App"]] as const;
const TABS = ALL_TABS.filter(([k]) => SHOW_PHONE || k !== "phone");
const TAB_KEYS = TABS.map(([k]) => k);

export function Sources() {
  const [tab, setTab] = useSettingsTab(TAB_KEYS);
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
  const [pauseMin, setPauseMin] = useState(pausesOnMinimize);
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
        <PageHeader title="Settings" subtitle="Your folders, your backups, how the app looks, and what it does with your files." />
        <div className="card">
          <strong style={{ color: "var(--danger)" }}>Couldn't load your settings.</strong>
          <p className="sub" style={{ margin: "8px 0 14px" }}>Your settings didn't load, so nothing here can be changed until they do. Your saved settings are safe.</p>
          <Button variant="ghost" onClick={load}>Try again</Button>
        </div>
      </>
    );
  }

  return (
    <div className="settings">
      <PageHeader
        title="Settings"
        subtitle="Your folders, your backups, how the app looks, and what it does with your files."
        actions={saved
          ? <span className="pill pill--ok" role="status">Saved</span>
          : <span className="faint settings-autosave">Changes save by themselves</span>}
      />

      {saveError && <div className="banner banner--warn"><Icon name="alert" className="banner__icon" />{saveError}</div>}

      {!beta && <PlanCard />}

      <SetTabs tabs={TABS} value={tab} onChange={setTab} />
      <SetPanel tab={tab}>
      {tab === "folders" && <>
      <SetRow title="Project folders" help="Where your projects live. Backups looks in these folders, and the folders inside them.">
        <FolderTable paths={cfg.sources} loaded={loaded} empty="No folders yet." onRemove={removeSource} />
        <Button variant="ghost" size="sm" onClick={addSource} disabled={!loaded}><Icon name="plus" size={14} />Add folder</Button>
      </SetRow>

      <SetRow title="Export folders"
        help="Where your finished songs get saved. Backups finds each song here and puts it with its project, so you don't have to."
        info="Backups always looks in each project's own folder, plus folders named like Exports or Bounces near your projects. Add any other place you save songs. It only reads these folders; it never moves or changes a file. Uploader uses the same list.">
        <ExportFolders />
      </SetRow>

      <SetRow title="Sample folders"
        help={<>Where your samples live, so missing ones can be found and relinked. Your <code>~/Splice</code> folder is always searched.</>}
        info="When a project is missing samples, the finder searches these folders (plus your project folders) for a file of the same name and relinks it. Point it at wherever your samples live: Splice, a packs drive, an old project archive.">
        <FolderTable paths={libraries} loaded={loaded} empty="No extra folders. Splice is still searched." onRemove={removeLibrary} />
        <Button variant="ghost" size="sm" onClick={addLibrary} disabled={!loaded}><Icon name="plus" size={14} />Add folder</Button>
      </SetRow>

      </>}
      {tab === "backups" && <>
      <SetRow title="Backup drive" help="Where the backups are kept: an external drive, a network drive, or a Dropbox or Google Drive folder. You own every copy.">
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
              <span className="faint drive__nums">{cfg.dest ? (ov && !ov.nas.reachable ? "Can't reach this folder right now" : "Folder set") : "Pick an external drive, a network drive or any folder"}</span>
            )}
          </div>
          <Button variant="ghost" onClick={pickDest} disabled={!loaded}>{cfg.dest ? "Change…" : "Choose…"}</Button>
        </div>
        {cloud.folders.some((f) => f.path) && (
          <div className="set-inline">
            <span className="set-note">Or use</span>
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
        info="Also copy every backup to a second place: a cloud-synced folder (Dropbox, Google Drive, iCloud, OneDrive) or another drive. That way one fire, theft or dead drive can't take every copy.">
        {canCloud ? (
          <>
            <FolderTable paths={mirrors} loaded={loaded} empty="No second copy yet." onRemove={removeMirror} icon="link" />
            <div className="set-inline">
              <Button variant="ghost" size="sm" onClick={addMirror} disabled={!loaded}><Icon name="plus" size={14} />Add folder</Button>
              {providers.map((p) => (
                <Button key={p.key} variant="ghost" size="sm" onClick={() => connectCloud(p.key, p.label)}
                  disabled={!rclone.available || connecting !== null}>
                  {connecting === p.key ? `Waiting for ${p.label} sign-in…` : `Connect ${p.label}`}
                </Button>
              ))}
            </div>
            {connectMsg && <p className="set-note set-note--ok">{connectMsg}</p>}
            {connectErr && <p className="set-note set-note--bad">{connectErr}</p>}
            {rclone.available && rclone.remotes.length > 0 && (
              <div>
                <p className="set-note" style={{ marginBottom: 7 }}>Cloud accounts already set up on this {words.computer}</p>
                <div className="set-inline">
                  {rclone.remotes.map((r) => (
                    <button key={r} className="chip" onClick={() => addRemote(r)}
                      disabled={mirrors.includes(`${r}:LazyCreatives-Backups`)}>+ {r}</button>
                  ))}
                </div>
              </div>
            )}
            {!rclone.available && (
              <p className="set-note">
                To sign in to a cloud account from here, install the free <strong>rclone</strong> helper first. Adding a synced folder works without it.
              </p>
            )}
          </>
        ) : (
          <div className="locked-note">
            <Icon name="lock" size={14} /> Copy every backup to your cloud or a second drive. A <strong style={{ color: "var(--text)" }}>Studio</strong> feature.
          </div>
        )}
      </SetRow>

      <SetRow title={<>Automatic backup{!canSchedule && <ProBadge />}</>}
        help={`Leave the app running (it lives in your ${words.tray}) and it backs up on its own.`}>
        <Choice label="Automatic backup" value={cfg.interval_minutes} options={PRESETS} disabled={!loaded || !canSchedule}
          onChange={(m) => setCfg({ ...cfg, interval_minutes: m })} />
        {canSchedule ? (
          cfg.interval_minutes > 0
            ? <span className="pill pill--ok">On, backs up {fmtInterval(cfg.interval_minutes)}{nextRun ? `, next ${fmtNext(nextRun)}` : ""}</span>
            : <span className="pill pill--skipped">Off. You back up when you choose</span>
        ) : (
          <div className="locked-note"><Icon name="lock" size={14} /> Automatic backups are a <strong style={{ color: "var(--text)" }}>Pro</strong> feature.</div>
        )}
      </SetRow>

      </>}
      {tab === "look" && <>
      <SetRow title="Look" help="How the app is laid out. Switch any time; nothing else changes.">
        <div className="lookpick" role="group" aria-label="Look">
          {([["crate", "Crate", "Rows like a DJ library, with waveforms and genre stripes"],
             ["sleeve", "Sleeve", "Cover art first, like an album shelf"]] as const).map(([k, name, what]) => (
            <button key={k} type="button" className="lookpick__opt" aria-pressed={look === k} onClick={() => { if (look !== k) fadeSwitch(() => setLook(k)); }}>
              <LookThumb kind={k} />
              <span><strong style={{ fontWeight: 600 }}>{name}</strong><br /><small>{what}</small></span>
            </button>
          ))}
        </div>
      </SetRow>
      <SetRow title="Light or dark" help="Dark ink or light paper, in either look.">
        <ThemePicker />
      </SetRow>
      <ReadingSettings />
      <SetRow title="Rating mark" help="What ratings are drawn with. Rate a project from its row, or right-click it.">
        <GlyphPicker />
      </SetRow>

      <SetRow title="Your pictures"
        help="Put your own pictures on project covers: behind the drawing, or as the whole cover. Change one project from its page or by right-clicking it.">
        <CoverShelf sample={coverSample?.name ?? "Your project"} sampleGenre={coverSample?.genre} />
      </SetRow>

      </>}
      {tab === "privacy" && <>
      <p className="set-intro">Your music stays yours. Here is everything Backups touches, and everything that leaves your {words.computer}.</p>
      <SetRow title="Your files" help="Projects, samples and exported songs.">
        <p className="set-about">Backups only reads them. It never moves, changes or deletes a file. The one exception is Tidy names, which renames a song's files only when you press Rename, and offers Undo.</p>
      </SetRow>
      <SetRow title="Your backups" help="Where the copies live.">
        <p className="set-about">Only in the folders you pick on the Backups tab: your own drive, or your own Dropbox, Google Drive or iCloud folder. Lazy Creatives has no copy and never sees your music.</p>
      </SetRow>
      <SetRow title={`What leaves your ${words.computer}`} help="No tracking, no accounts, no adverts.">
        <p className="set-about">Checking for updates asks GitHub for the newest version number. If you turn on a second copy in the cloud, your backups go to your own cloud account.{SHOW_PHONE && " If you switch on Let my phone connect, the songs you pick go to your own paired phone over your home Wi-Fi."} Nothing else is sent.</p>
      </SetRow>
      <SetRow title="Something not working?"
        help="Opens a short report on GitHub with your app version and computer type filled in. You read it before you send it. If the app ever crashes, it offers the same report the next time it opens.">
        <Button variant="ghost" size="sm" onClick={() => (window as any).ablebackup?.reportProblem?.()}>Report a problem</Button>
      </SetRow>
      </>}
      {SHOW_PHONE && tab === "phone" && <YourPhone />}
      {tab === "app" && <>
      {openAtLogin !== null && (
        <SetRow title={`Start with your ${words.computer}`}
          help="Opens Backups when you log in, so automatic backups keep running.">
          <OnOff label={`Start with your ${words.computer}`} on={openAtLogin} onChange={toggleOpenAtLogin} />
          {!openAtLogin && cfg.interval_minutes > 0 &&
            <p className="set-note">Automatic backups only run while the app is open.</p>}
        </SetRow>
      )}
      <SetRow title="Pause when minimized"
        help="Stops the music when you minimize the window. Press play to carry on.">
        <OnOff label="Pause when minimized" on={pauseMin} onChange={(on) => { keep(PAUSE_ON_MINIMIZE, on); setPauseMin(on); }} />
      </SetRow>

      <SetRow title="What it does" help="Lazy Creatives. Looks lazy. Works obsessively.">
        <p className="set-about">Backups lays out every music project on this computer to browse, with the songs you exported from each. Turn backups on and it keeps checked copies too. It only reads your projects; it never changes them.</p>
      </SetRow>
      <SetRow title="Updates" help="The app checks for a new version by itself. Press Check for updates to look right now.">
        <UpdateCheck />
      </SetRow>
      </>}
      </SetPanel>
    </div>
  );
}

// Your phone: a switch that lets paired phones in over home Wi-Fi, a code to scan
// to pair one, and the paired phones with a Remove button each. The phone gets its
// own copies of the songs its owner picks; nothing on this computer is changed.
function YourPhone() {
  const api = makeApi();
  const [st, setSt] = useState<PhoneStatus | null>(null);
  const [code, setCode] = useState<PhoneCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  function load() {
    setFailed(false);
    api.phoneStatus().then(setSt).catch(() => setFailed(true));
  }
  useEffect(load, []);
  // A fresh code while the switch is on; each lasts ten minutes, so renew it in time.
  useEffect(() => {
    if (!st?.enabled) { setCode(null); return; }
    let live = true;
    const get = () => api.phoneCode().then((c) => live && setCode(c)).catch(() => {});
    get();
    const t = window.setInterval(get, 9 * 60 * 1000);
    return () => { live = false; window.clearInterval(t); };
  }, [st?.enabled]);
  // While the code shows, look for a newly paired phone every few seconds.
  useEffect(() => {
    if (!st?.enabled) return;
    const t = window.setInterval(() => api.phoneStatus().then(setSt).catch(() => {}), 4000);
    return () => window.clearInterval(t);
  }, [st?.enabled]);

  async function flip(on: boolean) {
    setBusy(true);
    try { setSt(await api.phoneSwitch(on)); }
    catch (e) { toast(`Couldn't switch it ${on ? "on" : "off"}: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  // Removing can't be undone (the phone has to pair again), so ask first.
  async function forget(id: string, name: string) {
    const ok = await askConfirm({
      title: `Remove ${name}?`,
      body: "It's cut off straight away. To use it again, pair it with a new code.",
      confirm: "Remove phone", danger: true,
    });
    if (!ok) return;
    try { setSt(await api.phoneForget(id)); toast(`${name} can't connect any more.`); }
    catch (e) { toast(`Couldn't remove it: ${(e as Error).message}`); }
  }

  const on = !!st?.enabled;
  return (
    <>
      <SetRow title="Let my phone connect"
        help="Off until you switch it on. Only phones you've paired, on your home Wi-Fi.">
        <OnOff label="Let my phone connect" on={on} onChange={flip} disabled={busy || !st} />
        {failed && !st && (
          <div className="phone-failed" role="alert">
            <span>Couldn't check whether your phone can connect.</span>
            <Button variant="ghost" size="sm" onClick={load}>Try again</Button>
          </div>
        )}
        {on && code && (
          <div className="phone-pair">
            <QrCode text={code.link} />
            <p className="set-about">Open Lazy Creatives on your phone and scan this code. It works once, and a new one shows each time you come back here.</p>
          </div>
        )}
        <p className="set-note">
          Your phone gets its own copies of the songs you choose to keep on it. Files on this computer are only read, never changed, moved or converted.
        </p>
      </SetRow>
      <SetRow title="Paired phones" help="Remove one to cut it off straight away.">
        {!st || st.devices.length === 0
          ? <p className="faint" style={{ margin: 0, fontSize: 13 }}>{st ? "No phones yet." : failed ? "Couldn't load your paired phones." : "Loading…"}</p>
          : (
            <div className="table phone-cols">
              {st.devices.map((d) => (
                <div key={d.id} className="row cols">
                  <Icon name="headphones" size={15} className="faint" />
                  <span className="col-trunc" title={d.name}>{d.name}</span>
                  <span className="col-num">paired {fmtDay(d.paired_at * 1000, { year: false })}</span>
                  <span className="col-num">seen {fmtDay(d.last_seen * 1000, { year: false, time: true })}</span>
                  <span className="col-act"><Button variant="quiet" size="sm" aria-label={`Remove ${d.name}`} onClick={() => forget(d.id, d.name)}>Remove</Button></span>
                </div>
              ))}
            </div>
          )}
      </SetRow>
    </>
  );
}

// A code for the phone's camera, drawn as crisp squares.
function QrCode({ text }: { text: string }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cells: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c} ${r}h1v1h-1z`);
  return (
    <svg className="phone-qr" viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="Code to scan with your phone"
      shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={cells.join("")} fill="#0B0E12" />
    </svg>
  );
}

const pct = (v: number, of: number) => Math.max(0, Math.min(100, of > 0 ? (v / of) * 100 : 0));

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
            <span className="mono col-trunc" style={{ fontSize: 12, color: "var(--text-dim)" }} title={p}>{p}</span>
            <CopyButton text={p} what="folder path" size={13} />
          </span>
          <span className="col-act"><Button variant="quiet" size="sm" onClick={() => onRemove(p)}>Remove</Button></span>
        </div>
      ))}
    </div>
  );
}

// Where exported songs are looked for: the user's own folders, the ones Backups
// found by itself, and Uploader's (shown only, so people see why a song was found).
type ExportFolderSet = Awaited<ReturnType<ReturnType<typeof makeApi>["exportFolders"]>>;
export function ExportFolders() {
  const [f, setF] = useState<ExportFolderSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // While the folders are looked through: "Looking… folder 3 of 12", then one line
  // saying what came of it.
  const [looking, setLooking] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const load = () => api.exportFolders().then(setF).catch(() => setErr("Couldn't load your export folders."));
  useEffect(() => { load(); }, []);

  const linkedLine = (n: number | null | undefined) => n == null ? "Done looking."
    : `Done. ${fmtCount(n)} ${n === 1 ? "song is" : "songs are"} linked to your projects.`;
  // Follow a look that's still going after the first answer, until it ends.
  async function follow() {
    for (;;) {
      const st = await api.exportsStatus().catch(() => null);
      if (!st) { setLooking(null); return null; }
      if (!st.running) { setLooking(null); return st.linked; }
      setLooking({ done: st.folders_done, total: st.folders_total });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  // `look`: the change makes Backups look through the folders, so show it working
  // and say what it found.
  async function run(fn: () => Promise<unknown>, done?: string, look = false) {
    setBusy(true); setErr(null);
    if (look) { setResult(null); setLooking({ done: 0, total: 0 }); }
    try {
      const r: any = await fn();
      await load();
      if (look) {
        const linked = r?.running ? await follow() : r?.linked;
        setLooking(null);
        setResult(linkedLine(linked));
      } else if (done) toast(done);
    }
    catch (e: any) { setLooking(null); setErr(e?.message ? `Couldn't change that: ${e.message}` : "Couldn't change that. Try again."); }
    finally { setBusy(false); }
  }
  const mine = f?.folders ?? [];
  const ignored = f?.ignored ?? [];
  async function add() {
    const dir: string | null = await (window as any).ablebackup?.pickFolder?.();
    if (dir && !mine.includes(dir)) run(() => api.setExportFolders([...mine, dir]), undefined, true);
  }
  function remove(p: string) {
    run(() => api.setExportFolders(mine.filter((x) => x !== p)));
    toast(`Stopped looking for songs in ${baseName(p)}.`, { label: "Undo", onClick: () => run(() => api.setExportFolders(mine)) });
  }
  function ignore(p: string) {
    run(() => api.setExportFolders(mine, [...ignored, p]));
    toast(`Won't look in ${baseName(p)} again.`, { label: "Undo", onClick: () => run(() => api.setExportFolders(mine, ignored)) });
  }
  function unignore(p: string) {
    run(() => api.setExportFolders(mine, ignored.filter((x) => x !== p)), undefined, true);
  }

  const rows = exportFolderRows(f).map((r) => ({
    ...r, from: EXPORT_FOLDER_FROM[r.kind],
    act: r.kind === "mine" ? ["Remove", () => remove(r.path)] as const
      : r.kind === "found" ? ["Don't look here", () => ignore(r.path)] as const : undefined,
  }));
  return (
    <>
      {rows.length === 0
        ? <p className="faint" style={{ margin: 0, fontSize: 13 }}>{f ? "None yet. Backups still looks in each project's own folder." : "Loading…"}</p>
        : (
          <div className="table exportfolder-cols">
            {rows.map((r) => (
              <div key={r.path} className="row cols">
                <Icon name="folder" size={15} className="faint" />
                <span className="pathline" onContextMenu={(e) => openMenu(e, [
                  { label: `Show in ${osWords().fileManager}`, onClick: () => (window as any).ablebackup?.revealPath?.(r.path) },
                  { label: "Copy folder path", onClick: () => { copyText(r.path); } },
                  ...(r.act ? ["-" as const, { label: r.act[0], onClick: r.act[1], danger: true }] : []),
                ])}>
                  <span className="mono col-trunc" style={{ fontSize: 12, color: "var(--text-dim)" }} title={r.path}>{r.path}</span>
                  <CopyButton text={r.path} what="folder path" size={13} />
                </span>
                <span className="faint col-trunc" style={{ fontSize: 12 }}>{r.from}</span>
                <span className="col-act">{r.act && <Button variant="quiet" size="sm" disabled={busy} onClick={r.act[1]}>{r.act[0]}</Button>}</span>
              </div>
            ))}
          </div>
        )}
      {ignored.length > 0 && (
        <div className="exportfolder-hidden">
          <button type="button" className="linkbtn" aria-expanded={showHidden} onClick={() => setShowHidden((x) => !x)}>
            <Icon name={showHidden ? "chevronDown" : "chevronRight"} size={12} />Hidden folders ({fmtCount(ignored.length)})
          </button>
          {showHidden && (
            <div className="table exportfolder-cols">
              {ignored.map((p) => (
                <div key={p} className="row cols">
                  <Icon name="folder" size={15} className="faint" />
                  <span className="mono col-trunc" style={{ fontSize: 12, color: "var(--text-faint)" }} title={p}>{p}</span>
                  <span className="faint col-trunc" style={{ fontSize: 12 }}>Not looked in</span>
                  <span className="col-act"><Button variant="quiet" size="sm" disabled={busy} onClick={() => unignore(p)}>Show again</Button></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {err && <p className="set-note set-note--bad">{err}</p>}
      {(looking || result) && (
        <div className="sub" role="status" style={{ margin: 0, fontSize: 12 }}>
          {looking
            ? (looking.total > 0 ? `Looking for songs… folder ${fmtCount(looking.done)} of ${fmtCount(looking.total)}` : "Looking for songs…")
            : result}
        </div>
      )}
      <div className="set-inline">
        <Button variant="ghost" size="sm" onClick={add} disabled={!f || busy}><Icon name="plus" size={14} />Add folder</Button>
        <Button variant="ghost" size="sm" disabled={!f || busy} title="Look through these folders again for songs saved since"
          onClick={() => run(() => api.refreshExports(), undefined, true)}>{looking ? "Looking…" : "Look again"}</Button>
      </div>
    </>
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
