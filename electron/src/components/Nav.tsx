import { useEffect, useState } from "react";
import type { Tab } from "../App";
import { LcBrand } from "./LcBrand";
import { Icon, type IconName } from "./Icon";
import { useEntitlement } from "../entitlement";
import { openPalette } from "./Palette";
import { IS_MAC } from "../desktop";
import { COMPANION_KEYS, openCompanion } from "../companion";
import { NavRecents } from "./Recents";

const ITEMS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "library", label: "Library", icon: "library" },
  { id: "dig", label: "Dig", icon: "dig" },
  { id: "albums", label: "Albums", icon: "music" },
  { id: "plugins", label: "Plugins", icon: "plug" },
  { id: "settings", label: "Settings", icon: "settings" },
];

// Below 880px wide the sidebar shows icons only (lazy-ui.css): each one then needs
// its name as a tooltip. Screen readers get the name at every width.
const ICONS_ONLY = "(max-width: 880px)";
function useIconsOnly(): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(ICONS_ONLY).matches);
  useEffect(() => {
    const m = window.matchMedia?.(ICONS_ONLY);
    if (!m) return;
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

export function Nav({ tab, onNavigate, busy, flowActive, onOpenRecent, openId }: {
  tab: Tab; onNavigate: (t: Tab) => void; busy?: boolean; flowActive?: boolean;
  onOpenRecent: (id: string) => void; openId?: string | null;  // the project page showing now
}) {
  const { beta, tier } = useEntitlement();
  const plan = beta ? "free beta" : tier === "free" ? "free plan" : `${tier} plan`;
  const iconsOnly = useIconsOnly();
  return (
    <nav className="nav">
      <LcBrand app="Backups" tag={`Lazy Creatives · ${plan}`} busy={busy} />
      <button type="button" className="nav__find" onClick={openPalette} title="Find a page, project or action">
        <Icon name="search" size={14} /><span>Find anything</span><kbd>{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {ITEMS.map((it) => {
        const on = tab === it.id && !flowActive;
        return (
          <button key={it.id} onClick={() => onNavigate(it.id)} aria-current={on ? "page" : undefined}
            aria-label={it.label} title={iconsOnly ? it.label : undefined}
            className={`nav__item${on ? " nav__item--active" : ""}`}>
            <Icon name={it.icon} className="nav__icon" />
            <span className="nav__label">{it.label}</span>
            {it.id === "home" && busy && <span className="nav__dot" />}
          </button>
        );
      })}
      <NavRecents onOpen={onOpenRecent} current={openId} />
      <div className="nav__spacer" />
      <NarrowWindowButton />
    </nav>
  );
}

// Opens the narrow window that sits beside your music program (see companion.js).
// Same in Backups and Uploader.
export function NarrowWindowButton() {
  return (
    <button type="button" className="nav__item nav__narrow" onClick={openCompanion} aria-label="Narrow window"
      title={`A narrow window to keep beside your music program (${COMPANION_KEYS})`}>
      <Icon name="narrow" className="nav__icon" />
      <span className="nav__label">Narrow window</span>
    </button>
  );
}
