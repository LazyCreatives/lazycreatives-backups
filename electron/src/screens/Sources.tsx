import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Config } from "../types";
import { Button } from "../components/Button";
import { PageHeader } from "../components/PageHeader";

const api = makeApi();

const PRESETS = [
  { label: "Off", min: 0 },
  { label: "Every hour", min: 60 },
  { label: "Every 6 hours", min: 360 },
  { label: "Once a day", min: 1440 },
];

export function Sources() {
  const [cfg, setCfg] = useState<Config>({ sources: [], dest: "", interval_minutes: 0, libraries: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function load() {
    setLoadError(false);
    api.getSettings()
      .then((c) => { setCfg(c); setLoaded(true); })
      .catch(() => setLoadError(true));
  }
  useEffect(load, []);

  async function addSource() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir && !cfg.sources.includes(dir)) setCfg({ ...cfg, sources: [...cfg.sources, dir] });
  }
  async function pickDest() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir) setCfg({ ...cfg, dest: dir });
  }
  function removeSource(s: string) {
    setCfg({ ...cfg, sources: cfg.sources.filter((x) => x !== s) });
  }
  async function save() {
    if (!loaded) return;  // never overwrite stored settings with an un-loaded default
    setSaveError(null);
    try {
      const next = await api.saveSettings({ ...cfg, interval_minutes: Math.max(0, cfg.interval_minutes) });
      setCfg(next); setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      setSaveError(e.message || "Save failed");
    }
  }

  const presetMatch = PRESETS.some((p) => p.min === cfg.interval_minutes);

  if (loadError) {
    return (
      <>
        <PageHeader title="Sources & NAS" subtitle="Where to look for projects, and where to store backups." />
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
        title="Sources & NAS"
        subtitle="Where to look for projects, and where to store backups."
        actions={<Button onClick={save} disabled={!loaded}>{saved ? "Saved ✓" : "Save settings"}</Button>}
      />

      {saveError && <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", marginBottom: 16 }}>{saveError}</div>}

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
        <h2>NAS destination</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input readOnly value={cfg.dest} placeholder="No destination set"
            style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", padding: "10px 12px", borderRadius: 8 }} />
          <Button variant="ghost" onClick={pickDest} disabled={!loaded}>Choose…</Button>
        </div>
        <div className="sub" style={{ margin: "8px 0 0", fontSize: 12 }}>
          <span style={{ color: cfg.dest ? "var(--accent-2)" : "var(--text-dim)" }}>●</span>{" "}
          {cfg.dest ? "Destination set" : "Pick a mounted NAS folder (or any drive)"}
        </div>
      </div>

      <div className="card">
        <h2>Automatic backup</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <select
            value={presetMatch ? cfg.interval_minutes : -1}
            disabled={!loaded}
            onChange={(e) => { const v = Number(e.target.value); if (v >= 0) setCfg({ ...cfg, interval_minutes: v }); }}
          >
            {PRESETS.map((p) => <option key={p.min} value={p.min}>{p.label}</option>)}
            {!presetMatch && <option value={-1} disabled>Custom ({cfg.interval_minutes} min)</option>}
          </select>
          <span className="sub" style={{ margin: 0, fontSize: 12 }}>Runs while the app is open (tray counts).</span>
        </div>
      </div>
    </>
  );
}
