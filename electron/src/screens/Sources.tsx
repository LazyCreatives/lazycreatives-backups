import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Config } from "../types";
import { Button } from "../components/Button";

const api = makeApi();

export function Sources() {
  const [cfg, setCfg] = useState<Config>({ sources: [], dest: "", interval_minutes: 0 });
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.getSettings().then(setCfg).catch(() => {}); }, []);

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
    const next = await api.saveSettings(cfg);
    setCfg(next); setSaved(true); setTimeout(() => setSaved(false), 1500);
  }

  return (
    <>
      <h1>Sources & NAS</h1>
      <p className="sub">Where to look for projects, and where to store backups.</p>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <strong>Source folders</strong>
          <Button variant="ghost" onClick={addSource}>+ Add folder</Button>
        </div>
        {cfg.sources.length === 0 && <p className="sub">No folders yet.</p>}
        {cfg.sources.map((s) => (
          <div key={s} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span style={{ color: "var(--text-dim)" }}>{s}</span>
            <button onClick={() => removeSource(s)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer" }}>remove</button>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <strong>NAS destination</strong>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          <input readOnly value={cfg.dest} placeholder="No destination set"
            style={{ flex: 1, background: "var(--bg-elev-2)", border: "1px solid var(--border)", color: "var(--text)", padding: "10px 12px", borderRadius: 8 }} />
          <Button variant="ghost" onClick={pickDest}>Choose…</Button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <strong>Automatic backup</strong>
        <div style={{ marginTop: 12 }}>
          <label className="sub">Every&nbsp;</label>
          <input type="number" min={0} value={cfg.interval_minutes}
            onChange={(e) => setCfg({ ...cfg, interval_minutes: Number(e.target.value) })}
            style={{ width: 80, background: "var(--bg-elev-2)", border: "1px solid var(--border)", color: "var(--text)", padding: "8px", borderRadius: 8 }} />
          <span className="sub">&nbsp;minutes (0 = off, app must be running)</span>
        </div>
      </div>

      <Button onClick={save}>{saved ? "Saved ✓" : "Save settings"}</Button>
    </>
  );
}
