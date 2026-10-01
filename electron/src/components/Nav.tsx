import type { Tab } from "../App";
import { BrandMark } from "./BrandMark";

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
  history: "M3 8l9-4 9 4-9 4-9-4z M3 8v8l9 4 9-4V8",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5H9.5L9 4.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.5 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z",
};

const ITEMS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export function Nav({ tab, onNavigate, busy, flowActive }: {
  tab: Tab; onNavigate: (t: Tab) => void; busy?: boolean; flowActive?: boolean;
}) {
  return (
    <nav className="nav">
      <div className="nav__brand">
        <div className="nav__logo" title="LazyCreatives Backups">
          <BrandMark active={busy} />
        </div>
        <span className="nav__brandname">LazyCreatives Backups</span>
      </div>
      {ITEMS.map((it) => (
        <button key={it.id} onClick={() => onNavigate(it.id)}
          className={`nav__item${tab === it.id && !flowActive ? " nav__item--active" : ""}`}>
          <Icon path={ICONS[it.id]} />
          {it.label}
          {it.id === "home" && busy && <span className="nav__dot" />}
        </button>
      ))}
    </nav>
  );
}
