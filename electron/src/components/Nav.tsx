import type { Tab } from "../App";
import { LcBrand } from "./LcBrand";
import { Icon, type IconName } from "./Icon";
import { useEntitlement } from "../entitlement";

const ITEMS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "library", label: "Library", icon: "library" },
  { id: "dig", label: "Dig", icon: "dig" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function Nav({ tab, onNavigate, busy, flowActive }: {
  tab: Tab; onNavigate: (t: Tab) => void; busy?: boolean; flowActive?: boolean;
}) {
  const { beta, tier } = useEntitlement();
  const plan = beta ? "free beta" : tier === "free" ? "free plan" : `${tier} plan`;
  return (
    <nav className="nav">
      <LcBrand app="Backups" tag={`Lazy Creatives · ${plan}`} busy={busy} />
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
    </nav>
  );
}
