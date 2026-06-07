import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Config } from "../types";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";
import { Info } from "../components/Info";
import { PlanCard } from "../components/PlanCard";
import { ProBadge } from "../components/ProBadge";
import { useEntitlement } from "../entitlement";
import { fmtInterval, fmtClock } from "../format";

const api = makeApi();

const PRESETS = [
  { label: "Off", min: 0 },
  { label: "Hourly", min: 60 },
  { label: "Every 6h", min: 360 },
  { label: "Daily", min: 1440 },
  { label: "Weekly", min: 10080 },
];

export function Sources() {
  const [cfg, setCfg] = useState<Config>({ sources: [], dest: "", interval_minutes: 0, libraries: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [nextRun, setNextRun] = useState<string | null>(null);
  const { allows } = useEntitlement();
  const canSchedule = allows("scheduled");
  const canCloud = allows("cloud_backup");

  function refreshNextRun() {
    api.overview().then((o) => setNextRun(o.schedule.next_run ?? null)).catch(() => {});
  }
  function load() {
    setLoadError(false);
    api.getSettings()
      .then((c) => { setCfg(c); setLoaded(true); })
      .catch(() => setLoadError(true));
  }
  useEffect(() => { load(); refreshNextRun(); }, []);

  async function addSource() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir && !cfg.sources.includes(dir)) setCfg({ ...cfg, sources: [...cfg.sources, dir] });
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
  function removeMirror(m: string) { setCfg({ ...cfg, mirrors: mirrors.filter((x) => x !== m) }); }
  function removeSource(s: string) {
    setCfg({ ...cfg, sources: cfg.sources.filter((x) => x !== s) });
  }
  async function save() {
    if (!loaded) return;  // never overwrite stored settings with an un-loaded default
    setSaveError(null);
    try {
      const next = await api.saveSettings({ ...cfg, interval_minutes: Math.max(0, cfg.interval_minutes) });
      setCfg(next); setSaved(true); setTimeout(() => setSaved(false), 1500);
      refreshNextRun();
    } catch (e: any) {
      setSaveError(e.message || "Save failed");
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Settings" subtitle="Where to find your projects, and where to keep the backups." />
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <strong style={{ color: "var(--danger)" }}>Couldn't reach the backup service.</strong>
          <p className="sub" style={{ margin: "8px 0 14px" }}>Settings weren't loaded — saving is disabled so your stored config isn't overwritten.</p>
          <Button variant="ghost" onClick={load}>Retry</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Where to find your projects, and where to keep the backups."
        actions={<Button onClick={save} disabled={!loaded}>{saved ? "Saved ✓" : "Save settings"}</Button>}
      />

      {saveError && <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", marginBottom: 16 }}>{saveError}</div>}

      <PlanCard />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Source folders</h2>
          <Button variant="ghost" onClick={addSource} disabled={!loaded}>+ Add folder</Button>
        </div>
        {cfg.sources.length === 0 && <p className="sub" style={{ margin: 0 }}>{loaded ? "No folders yet." : "Loading…"}</p>}
        {cfg.sources.map((s) => (
          <div key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", gap: 12 }}>
            <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
            <button className="linkbtn" onClick={() => removeSource(s)} style={{ color: "var(--danger)", flexShrink: 0 }}>remove</button>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ display: "flex", alignItems: "center" }}>Backup destination
          <Info text="A folder on your own NAS or drive where backups are kept. No cloud, no subscription — you own every copy." /></h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input readOnly value={cfg.dest} placeholder="No destination set"
            style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", padding: "10px 12px", borderRadius: 8 }} />
          <Button variant="ghost" onClick={pickDest} disabled={!loaded}>Choose…</Button>
        </div>
        <div className="sub" style={{ margin: "8px 0 0", fontSize: 12 }}>
          <span style={{ color: cfg.dest ? "var(--accent-2)" : "var(--text-dim)" }}>●</span>{" "}
          {cfg.dest ? "Destination set" : "Pick a mounted NAS folder, external drive, or any folder"}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ margin: 0, display: "flex", alignItems: "center" }}>Cloud &amp; offsite backup
            {!canCloud && <ProBadge label="STUDIO" />}
            <Info text="Also copy every backup to a second place — a cloud-synced folder (Dropbox, Google Drive, iCloud, OneDrive) or another drive. If your NAS dies or the studio floods, the work survives. That's the offsite '1' in 3-2-1." /></h2>
          {canCloud && <Button variant="ghost" onClick={addMirror} disabled={!loaded}>+ Add destination</Button>}
        </div>
        {canCloud ? (
          <>
            <p className="sub" style={{ margin: "4px 0 10px", fontSize: 12.5 }}>
              Every backup is also copied to each of these. Point one at a Dropbox / Google Drive / iCloud folder for true offsite protection — it stays your own cloud account.
            </p>
            {mirrors.length === 0 && <p className="sub" style={{ margin: 0 }}>No offsite destinations yet.</p>}
            {mirrors.map((m) => (
              <div key={m} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", gap: 12 }}>
                <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>☁ {m}</span>
                <button className="linkbtn" onClick={() => removeMirror(m)} style={{ color: "var(--danger)", flexShrink: 0 }}>remove</button>
              </div>
            ))}
          </>
        ) : (
          <div className="locked-note" style={{ marginTop: 6 }}>
            🔒 Mirror every backup to your cloud (Dropbox, Drive, iCloud…) or a second drive for offsite <strong style={{ color: "var(--text)" }}>3-2-1</strong> protection — a <strong style={{ color: "var(--text)" }}>Studio</strong> feature.
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ display: "flex", alignItems: "center" }}>Automatic backup
          {!canSchedule && <ProBadge />}
          <Info text="Leave the app running (it lives in your menu-bar tray) and it backs up on this schedule on its own — set it and forget it." /></h2>
        <div className={`seg${canSchedule ? "" : " locked"}`} role="group" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {PRESETS.map((p) => (
            <button key={p.min} disabled={!loaded || !canSchedule}
              className={`seg__opt${cfg.interval_minutes === p.min ? " seg__opt--on" : ""}`}
              onClick={() => setCfg({ ...cfg, interval_minutes: p.min })}>{p.label}</button>
          ))}
        </div>
        {canSchedule ? (
          <div className="sub" style={{ margin: "11px 0 0", fontSize: 12.5 }}>
            {cfg.interval_minutes > 0 ? (
              <span style={{ color: "var(--accent-2)" }}>
                ✓ On — backs up {fmtInterval(cfg.interval_minutes)}
                {nextRun ? ` · next ${fmtClock(nextRun)}` : ""}. Keep the app running (menu-bar tray).
              </span>
            ) : "Off — you'll back up manually whenever you like."}
          </div>
        ) : (
          <div className="locked-note">🔒 Automatic backups are a <strong style={{ color: "var(--text)" }}>Pro</strong> feature. Back up manually any time — or unlock Pro above.</div>
        )}
      </div>
    </>
  );
}
