import type { Tab } from "../App";
import { BrandMark } from "./BrandMark";
import { useEntitlement } from "../entitlement";

function Icon({ path }: { path: string }) {
  return (
    <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const ICONS: Record<Tab, string> = {
  home: "M3 11l9-8 9 8 M5 10v10h5v-6h4v6h5V10",
  library: "M3 8l9-4 9 4-9 4-9-4z M3 8v8l9 4 9-4V8",
  dig: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z M12 6.5a5.5 5.5 0 0 1 5.5 5.5",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5H9.5L9 4.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.5 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z",
};

const ITEMS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "library", label: "Library" },
  { id: "dig", label: "Dig" },
  { id: "settings", label: "Settings" },
];

export function Nav({ tab, onNavigate, busy, flowActive }: {
  tab: Tab; onNavigate: (t: Tab) => void; busy?: boolean; flowActive?: boolean;
}) {
  const { beta } = useEntitlement();
  return (
    <nav className="nav">
      <div className="nav__brand nav__brand--lockup" title="Lazy Creatives — Backups">
        <BrandMark active={busy} />
        <span className="nav__brandtool">Backups{beta && <em className="nav__beta">free beta</em>}</span>
      </div>
      {ITEMS.map((it) => (
        <button key={it.id} onClick={() => onNavigate(it.id)}
          className={`nav__item${tab === it.id && !flowActive ? " nav__item--active" : ""}`}>
          <Icon path={ICONS[it.id]} />
          <span className="nav__label">{it.label}</span>
          {it.id === "home" && busy && <span className="nav__dot" />}
        </button>
      ))}
    </nav>
  );
}
