import { useEffect, useState } from "react";
import { openWhatsNew, type NoteGroup } from "./WhatsNew";

// The "Version / Check for updates" row in Settings. The check itself lives in
// electron/updater.js; this only shows its state and the one button that fits,
// plus "What's new" for this version, and the new version's list once one is out.
// Same file in both apps: it finds whichever app's bridge is there.

export type UpdateStatus = {
  current: string;
  state: "idle" | "checking" | "latest" | "downloading" | "available" | "ready" | "error" | "off";
  latest?: string;
  percent?: number;
  action?: "restart" | "download";
  message?: string;
  notes?: NoteGroup[];  // what's new in `latest`, from its release page
};

type Bridge = {
  updateStatus?: () => Promise<UpdateStatus>;
  checkForUpdates?: () => Promise<UpdateStatus>;
  applyUpdate?: () => Promise<void>;
  onUpdateStatus?: (cb: (s: UpdateStatus) => void) => () => void;
};
const bridge = (): Bridge | undefined => (window as any).ablebackup ?? (window as any).lazyupload;

// What the row says for each state: the pill's colour and text, and its button.
export function describeUpdate(s: UpdateStatus): {
  tone: "ok" | "running" | "error" | "skipped"; text: string; button: "check" | "restart" | "download" | null; note?: string;
} {
  switch (s.state) {
    case "checking": return { tone: "running", text: "Checking…", button: null };
    case "latest": return { tone: "ok", text: "You're up to date", button: "check" };
    case "downloading": return { tone: "running",
      text: `${s.latest} is available, downloading${s.percent ? ` (${s.percent}%)` : "…"}`, button: null };
    case "ready": return { tone: "ok", text: `${s.latest} is ready to install`, button: "restart",
      note: "Only the app closes and opens again, not your computer. Or it updates the next time you quit the app." };
    case "available": return { tone: "running", text: `${s.latest} is available`, button: "download",
      note: "Download it and install it over this one. Your settings and data stay as they are." };
    case "error": return { tone: "error", text: s.message || "Couldn't check for updates", button: "check" };
    case "off": return { tone: "skipped", text: "Update checks are turned off on this computer", button: null };
    default: return { tone: "skipped", text: "Checks on its own every few hours", button: "check" };
  }
}

export function UpdateCheck() {
  const [s, setS] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const b = bridge();
    b?.updateStatus?.().then(setS).catch(() => {});
    return b?.onUpdateStatus?.(setS);
  }, []);

  if (!s) return null;
  const d = describeUpdate(s);
  const check = () => { setS({ ...s, state: "checking" }); bridge()?.checkForUpdates?.().then(setS).catch(() => {}); };
  const apply = () => { bridge()?.applyUpdate?.(); };
  const upcoming = (s.state === "available" || s.state === "ready" || s.state === "downloading")
    && s.latest && s.notes && s.notes.length > 0
    ? { version: s.latest, groups: s.notes } : null;
  const titles = upcoming ? upcoming.groups.flatMap((g) => g.items.map((it) => ({ kind: g.kind, title: it.title }))) : [];

  return (
    <div className="updcheck">
      <div className="updcheck__row">
        <span className="updcheck__ver"><span className="faint">Version</span> <span className="mono">{s.current}</span></span>
        <span className={`pill pill--${d.tone} updcheck__state`} aria-live="polite">{d.text}</span>
        <span className="updcheck__act">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => openWhatsNew()}>What's new</button>
          {d.button === "check" && <button type="button" className="btn btn--ghost btn--sm" onClick={check}>Check for updates</button>}
          {d.button === "restart" && <button type="button" className="btn btn--primary btn--sm" onClick={apply}>Restart the app</button>}
          {d.button === "download" && <button type="button" className="btn btn--primary btn--sm" onClick={apply}>Open download page</button>}
          {d.button === null && <button type="button" className="btn btn--ghost btn--sm" disabled>Check for updates</button>}
        </span>
      </div>
      {d.note && <p className="updcheck__note faint">{d.note}</p>}
      {upcoming && (
        <div className="updcheck__next">
          <div className="updcheck__nexthead">
            <span>What's new in <span className="mono">{upcoming.version}</span></span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => openWhatsNew(upcoming)}>See all</button>
          </div>
          {titles.slice(0, 4).map((t, i) => (
            <div key={i} className="updcheck__nextrow">
              <span className={`wnew__tag wnew__tag--${t.kind.toLowerCase()}`}>{t.kind}</span>
              <span className="updcheck__nexttitle">{t.title}</span>
            </div>
          ))}
          {titles.length > 4 && <div className="updcheck__nextmore faint">…and {titles.length - 4} more</div>}
        </div>
      )}
    </div>
  );
}
