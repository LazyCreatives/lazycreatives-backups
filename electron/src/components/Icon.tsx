// Line icons for the Lazy Creatives UI kit. SHARED FILE: the same file lives in
// Backups and Uploader (electron/src/components/Icon.tsx); change both together.
// Every icon is a 24x24 stroke drawing in the current text colour, so it follows
// the button or label it sits in. Use these instead of emoji.

const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  library: "M4 6h16M4 12h16M4 18h16",
  dig: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M16 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM10 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  history: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  check: "M5 12l5 5L20 7",
  alert: "M12 9v4M12 17h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  close: "M6 6l12 12M18 6 6 18",
  play: "M7 4v16l13-8L7 4Z",
  pause: "M8 5v14M16 5v14",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  arrowLeft: "M19 12H5M11 18l-6-6 6-6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  crate: "M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9ZM5 9l1.5-4h11L19 9M9 13h6",
  columns: "M4 5h4v14H4ZM10 5h4v14h-4ZM16 5h4v14h-4Z",
  command: "M9 9V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V9Z",
  chart: "M4 20V11M10 20V5M16 20v-6M2 20h20",
  headphones: "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1v-4ZM20 15h-3v5h2a1 1 0 0 0 1-1v-4Z",
  flag: "M6 21V4M6 4h11l-2 4 2 4H6",
  comment: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  copy: "M9 9h11v11H9V9ZM5 15H4V4h11v1",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z",
  starFilled: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z",
  disc: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  // rating marks, each with a filled twin (see marks.ts)
  flame: "M12 21c-3.9 0-7-2.7-7-6.5 0-3.3 2.6-5.6 4-8.5.4 2 1.5 3.2 2.5 3.7.2-2.6 1.4-5.2 3.5-6.7-.3 2.8 1 4.6 2.3 6.3 1.3 1.7 1.7 3.2 1.7 5.2 0 3.8-3.1 6.5-7 6.5Z",
  flameFilled: "M12 21c-3.9 0-7-2.7-7-6.5 0-3.3 2.6-5.6 4-8.5.4 2 1.5 3.2 2.5 3.7.2-2.6 1.4-5.2 3.5-6.7-.3 2.8 1 4.6 2.3 6.3 1.3 1.7 1.7 3.2 1.7 5.2 0 3.8-3.1 6.5-7 6.5Z",
  heart: "M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z",
  heartFilled: "M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z",
  discFilled: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  dot: "M12 17.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z",
  dotFilled: "M12 17.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11Z",
  rows: "M4 5h16M4 9.5h16M4 14h16M4 18.5h16",
  narrow: "M4 4h16v16H4ZM14 4v16",                     // the narrow window beside your music program
  pin: "M9 3h6M10 3v6l-3 4h10l-3-4V3M12 13v8",        // keep the narrow window on top
  palette: "M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3c.4.5.5 1 .5 1.4 0 .7-.9 1.3-3 1.3ZM7.5 11h.01M10 7.5h.01M14.5 7.5h.01",
  image: "M4 5h16v14H4ZM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",  // a picture (Change cover)
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className, title }: {
  name: IconName; size?: number; className?: string; title?: string;
}) {
  const filled = name === "play" || name.endsWith("Filled");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"} fillRule="evenodd" stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
