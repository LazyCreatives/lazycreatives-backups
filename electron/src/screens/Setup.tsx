import { useState } from "react";
import { makeApi } from "../api";
import type { Config } from "../types";
import { Button } from "../components/Button";

const api = makeApi();

export function Setup({ onDone }: { onDone: (c: Config) => void }) {
  const [step, setStep] = useState(0); // 0 welcome, 1 sources, 2 destination
  const [sources, setSources] = useState<string[]>([]);
  const [dest, setDest] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addSource() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir && !sources.includes(dir)) setSources([...sources, dir]);
  }
  async function pickDest() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (dir) setDest(dir);
  }
  async function finish() {
    setSaving(true); setErr(null);
    try {
      const c = await api.saveSettings({ sources, dest, interval_minutes: 0, libraries: [] });
      onDone(c);
    } catch (e: any) { setErr(e.message || "Couldn't save settings"); setSaving(false); }
  }

  const canNext = step === 0 || (step === 1 && sources.length > 0);

  return (
    <div className="splash">
      <div className="wizard">
        <div className="wizard__head">
          <div className="nav__logo">LC</div>
          <div style={{ flex: 1 }}><strong>LazyCreatives Backups</strong></div>
          <span className="sub" style={{ margin: 0 }}>Step {step + 1} of 3</span>
        </div>
        <div className="wizard__dots">
          {[0, 1, 2].map((i) => <span key={i} className={`wizard__dot${i <= step ? " wizard__dot--on" : ""}`} />)}
        </div>

        {step === 0 && (
          <div className="wizard__body">
            <h1>Protect your projects</h1>
            <p className="sub">We find your projects, follow every sample, and save complete,
              de-duplicated copies to your own NAS — then re-read them to prove the backup opens.</p>
            <ul style={{ color: "var(--text-dim)", fontSize: 13, lineHeight: 1.9, paddingLeft: 18 }}>
              <li>Your samples never go missing</li>
              <li>Backups are verified, not just copied</li>
              <li>You own the storage — no cloud, no account</li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="wizard__body">
            <h1>Where are your projects?</h1>
            <p className="sub">Add the folders with your Ableton (.als), FL Studio (.flp), and Reaper (.rpp) projects.</p>
            <Button variant="ghost" onClick={addSource}>+ Add a folder</Button>
            <div style={{ marginTop: 12 }}>
              {sources.length === 0 && <p className="sub" style={{ margin: 0 }}>No folders yet.</p>}
              {sources.map((s) => (
                <div key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", gap: 12 }}>
                  <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
                  <button className="linkbtn" onClick={() => setSources(sources.filter((x) => x !== s))} style={{ color: "var(--danger)", flexShrink: 0 }}>remove</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard__body">
            <h1>Where should backups go?</h1>
            <p className="sub">Pick a mounted NAS folder (or any drive). This is where your snapshots live.</p>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input readOnly value={dest} placeholder="No destination set"
                style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", padding: "10px 12px", borderRadius: 8 }} />
              <Button variant="ghost" onClick={pickDest}>Choose…</Button>
            </div>
            <div className="sub" style={{ margin: "8px 0 0", fontSize: 12 }}>
              <span style={{ color: dest ? "var(--accent-2)" : "var(--text-dim)" }}>●</span>{" "}
              {dest ? "Destination set" : "Required to back up"}
            </div>
            {err && <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", marginTop: 14 }}>{err}</div>}
          </div>
        )}

        <div className="wizard__foot">
          {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button> : <span />}
          {step < 2
            ? <Button onClick={() => setStep(step + 1)} disabled={!canNext}>Next</Button>
            : <Button onClick={finish} disabled={!dest || saving}>{saving ? "Saving…" : "Finish & scan"}</Button>}
        </div>
      </div>
    </div>
  );
}
