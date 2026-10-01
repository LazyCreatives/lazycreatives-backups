// Words that depend on which computer the app runs on, so a Windows or Linux
// producer never reads "Mac" or "Finder". Falls back to the browser's guess when
// the desktop bridge isn't there (tests, the Vite dev page).

export type Os = "mac" | "windows" | "linux";

export function currentOs(): Os {
  const bridge = typeof window !== "undefined" ? (window as any).ablebackup : undefined;
  const p: string = bridge?.platform
    ?? (typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent : "");
  if (/^darwin$|mac/i.test(p)) return "mac";
  if (/^win32$|win/i.test(p)) return "windows";
  return "linux";
}

const WORDS: Record<Os, { computer: string; fileManager: string; tray: string }> = {
  mac: { computer: "Mac", fileManager: "Finder", tray: "menu bar" },
  windows: { computer: "PC", fileManager: "File Explorer", tray: "system tray" },
  linux: { computer: "computer", fileManager: "file manager", tray: "system tray" },
};

export function osWords(os: Os = currentOs()) {
  return WORDS[os];
}
