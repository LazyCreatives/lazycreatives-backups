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
  { id: "plugins", label: "Plugins", icon: "plug" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function Nav({ tab, onNavigate, busy, flowActive, onOpenRecent, openId }: {
  tab: Tab; onNavigate: (t: Tab) => void; busy?: boolean; flowActive?: boolean;
  onOpenRecent: (id: string) => void; openId?: string | null;  // the project page showing now
}) {
  const { beta, tier } = useEntitlement();
  const plan = beta ? "free beta" : tier === "free" ? "free plan" : `${tier} plan`;
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
    <button type="button" className="nav__item nav__narrow" onClick={openCompanion}
      title={`A narrow window to keep beside your music program (${COMPANION_KEYS})`}>
      <Icon name="narrow" className="nav__icon" />
      <span className="nav__label">Narrow window</span>
    </button>
  );
}
