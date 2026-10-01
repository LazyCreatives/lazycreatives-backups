import { useState } from "react";
import { useEntitlement } from "../entitlement";
import { makeApi } from "../api";
import { Button } from "./Button";

const api = makeApi();
// TODO(payments): replace with the real Lemon Squeezy product checkout link.
const CHECKOUT_URL = "https://lazycreatives.lemonsqueezy.com/checkout";

const PRO_PERKS = ["Every DAW (Ableton, FL, Reaper, Bitwig/Studio One)", "Automatic scheduled backups",
  "Auto-find missing samples", "Restore any backup", "Unlimited destinations"];

export function PlanCard() {
  const { tier, isPro, refresh } = useEntitlement();
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function activate() {
    setBusy(true); setErr(null);
    try { await api.activateLicense(key.trim()); setKey(""); refresh(); }
    catch (e: any) { setErr(e.message || "Couldn't activate that key"); }
    finally { setBusy(false); }
  }
  async function deactivate() { await api.deactivateLicense().catch(() => {}); refresh(); }
  function buy() { (window as any).ablebackup?.openExternal?.(CHECKOUT_URL); }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 9, margin: 0 }}>
        Your plan <span className={`pill ${isPro ? "pill--ok" : ""}`}>{tier.toUpperCase()}</span>
      </h2>
      {isPro ? (
        <>
          <p className="sub" style={{ margin: "8px 0 0" }}>
            You're on {tier === "studio" ? "Studio" : "Pro"} — every feature unlocked. Thanks for backing an indie tool 🙏
          </p>
          <button className="linkbtn" style={{ marginTop: 10 }} onClick={deactivate}>Deactivate this device</button>
        </>
      ) : (
        <>
          <p className="sub" style={{ margin: "8px 0 12px" }}>
            Free covers manual <strong style={{ color: "var(--text)" }}>Ableton</strong> backups. <strong style={{ color: "var(--accent)" }}>Pro</strong> unlocks the everyday workflow:
          </p>
          <ul style={{ margin: "0 0 14px", paddingLeft: 18, color: "var(--text-dim)", fontSize: 13, lineHeight: 1.8 }}>
            {PRO_PERKS.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <Button onClick={buy}>Get Pro — $59 once</Button>
            <span className="sub" style={{ margin: 0, fontSize: 12 }}>Pay once, own it forever. No subscription, no cloud.</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" placeholder="Already bought? Paste your license key" value={key}
              onChange={(e) => setKey(e.target.value)} style={{ flex: 1, maxWidth: 300 }} />
            <Button variant="ghost" onClick={activate} disabled={!key.trim() || busy}>{busy ? "Activating…" : "Activate"}</Button>
          </div>
          {err && <div className="sub" style={{ color: "var(--danger)", marginTop: 8, fontSize: 12 }}>{err}</div>}
        </>
      )}
    </div>
  );
}
