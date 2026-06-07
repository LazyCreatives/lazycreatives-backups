import type { Screen } from "../App";

function Icon({ path }: { path: string }) {
  return (
    <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const ICONS: Record<string, string> = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 13h7v7H4z",
  sources: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  scan: "M3 12a9 9 0 1 0 9-9 M12 12l5-3 M12 12v0 M12 7v0",
  backup: "M3 12h4l2 5 4-12 2 7h6",
  browse: "M3 8l9-4 9 4-9 4-9-4z M3 8v8l9 4 9-4V8",
};

const ITEMS: { id: Screen; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "sources", label: "Sources & NAS" },
  { id: "scan", label: "Scan & Back up" },
  { id: "backup", label: "Progress" },
  { id: "browse", label: "Browse" },
];

export function Nav({ screen, onNavigate, busy }: {
  screen: Screen; onNavigate: (s: Screen) => void; busy?: boolean;
}) {
  return (
    <nav className="nav">
      <div className="nav__brand">
        <div className="nav__logo">AB</div>
        <span className="nav__brandname">Ableton Backup</span>
      </div>
      {ITEMS.map((it) => (
        <button key={it.id} onClick={() => onNavigate(it.id)}
          className={`nav__item${screen === it.id ? " nav__item--active" : ""}`}>
          <Icon path={ICONS[it.id]} />
          {it.label}
          {it.id === "backup" && busy && <span className="nav__dot" />}
        </button>
      ))}
    </nav>
  );
}
