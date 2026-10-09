import { useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Info } from "./Info";

// Settings pages in both apps are built from these, so every row lines up the same:
// a plain heading over each group, then rows with the setting's name and a short
// line on the left and its controls on the right.

export function SetGroup({ title }: { title: string }) {
  return <h2 className="set-group">{title}</h2>;
}

export function SetRow({ title, help, info, children }: { title: ReactNode; help?: ReactNode; info?: string; children: ReactNode }) {
  return (
    <section className="set-row">
      <div className="set-row__label">
        <h3>{title}{info && <Info text={info} />}</h3>
        {help && <p>{help}</p>}
      </div>
      <div className="set-row__body">{children}</div>
    </section>
  );
}

// A row of buttons where exactly one is picked: On/Off, Public/Private, how often.
export function Choice<T extends string | number>({ label, value, options, onChange, disabled }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; disabled?: boolean;
}) {
  // Like any group of radio buttons: one Tab stop, and the arrow keys move the pick.
  const at = Math.max(0, options.findIndex(([v]) => v === value));
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    e.preventDefault();
    const n = (at + step + options.length) % options.length;
    onChange(options[n][0]);
    (e.currentTarget.children[n] as HTMLElement | undefined)?.focus();
  }
  return (
    <div className="seg set-choice" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map(([v, name], i) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} disabled={disabled} tabIndex={i === at ? 0 : -1}
          className={`seg__opt${value === v ? " seg__opt--on" : ""}`} onClick={() => onChange(v)}>{name}</button>
      ))}
    </div>
  );
}

const ON_OFF = [["on", "On"], ["off", "Off"]] as const;
export function OnOff({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return <Choice label={label} value={on ? "on" : "off"} options={ON_OFF} onChange={(v) => onChange(v === "on")} disabled={disabled} />;
}

// Settings is split into tabs, one short screen each. The last one opened is kept,
// and other screens can open a given tab (Home's "Turn on backups" opens Backups).
const TAB_KEY = "lc-settings-tab";
export function showSettingsTab(tab: string) {
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* opens on the first tab */ }
}
export function useSettingsTab<T extends string>(tabs: readonly T[]): [T, (t: T) => void] {
  const [tab, setTab] = useState<T>(() => {
    try { const v = localStorage.getItem(TAB_KEY) as T | null; return v && tabs.includes(v) ? v : tabs[0]; }
    catch { return tabs[0]; }
  });
  return [tab, (t) => { setTab(t); showSettingsTab(t); }];
}

export function SetTabs<T extends string>({ tabs, value, onChange }: {
  tabs: readonly (readonly [T, string])[]; value: T; onChange: (t: T) => void;
}) {
  // Left and right arrows move between tabs, Home and End jump to the ends, as in any tab row.
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const i = tabs.findIndex(([k]) => k === value);
    const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    const next = tabs[n][0];
    onChange(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    e.preventDefault();
  }
  return (
    <div className="set-tabs" role="tablist" aria-label="Settings" onKeyDown={onKey}>
      {tabs.map(([k, name]) => (
        <button key={k} type="button" role="tab" data-tab={k} id={`set-tab-${k}`} aria-selected={value === k}
          aria-controls="set-panel" tabIndex={value === k ? 0 : -1}
          className={`set-tabs__tab${value === k ? " set-tabs__tab--on" : ""}`} onClick={() => onChange(k)}>{name}</button>
      ))}
    </div>
  );
}

// The open tab's rows. It starts with the tab's name as a heading only screen
// readers see, so headings run in order: Settings, the tab, then each setting.
export function SetPanel({ tab, children }: { tab: string; children: ReactNode }) {
  const [name, setName] = useState("");
  useLayoutEffect(() => { setName(document.getElementById(`set-tab-${tab}`)?.textContent ?? ""); }, [tab]);
  return (
    <div className="set-panel" role="tabpanel" id="set-panel" aria-labelledby={`set-tab-${tab}`} key={tab} tabIndex={0}>
      {name && <h2 className="sr-only">{name}</h2>}
      {children}
    </div>
  );
}
