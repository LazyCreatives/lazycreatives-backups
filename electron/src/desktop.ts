import { useEffect, useRef, useState } from "react";
import { isTyping } from "./nav";

// Everyday desktop conveniences, the page side. SHARED FILE: the same file lives in
// Backups and Uploader (electron/src/desktop.ts); change both together.
//   - things remembered between launches (the last page, sort and filters)
//   - keyboard shortcuts: Cmd/Ctrl+K find anything, Cmd/Ctrl+F search, Cmd/Ctrl+, Settings, Cmd/Ctrl+1… pages,
//     Space play/pause,
//     Escape closes the open project, track or crate
//   - copy to the clipboard, progress on the dock / taskbar icon, drag and drop
//   - window glass: marks <html> when the window is see-through (see lazy-ui.css)

const bridge = () => (window as any).ablebackup || (window as any).lazyupload;
export const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

// ── remembered between launches ──────────────────────────────────────────────

// A saved value, or the fallback when there is none or it no longer fits.
export function recall<T>(key: string, fallback: T, valid: (v: unknown) => boolean = () => true): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function keep(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or off: skip */ }
}

// ── pause when minimized ─────────────────────────────────────────────────────

// Settings > "Pause when minimized": off unless switched on, kept between launches.
export const PAUSE_ON_MINIMIZE = "lc-pause-on-minimize";
export const pausesOnMinimize = () => recall(PAUSE_ON_MINIMIZE, false, (v) => typeof v === "boolean");

// Calls `cb` each time the window is minimized (see sendWindowMinimized in desktop.js).
export function onWindowMinimized(cb: () => void): () => void {
  return bridge()?.onWindowMinimized?.(cb) ?? (() => {});
}

// ── keyboard shortcuts ───────────────────────────────────────────────────────

export type Command = "find" | "palette" | "settings" | "back" | "forward" | "play" | "whats-new" | "shortcuts" | `page-${number}`;

// "page-2" → 2: Cmd/Ctrl + a number opens that page of the sidebar, top to bottom.
export function pageNumber(cmd: Command): number | null {
  const m = /^page-(\d)$/.exec(cmd);
  return m ? Number(m[1]) : null;
}

// Elements that use Space themselves (buttons, ticks, menus), so Space doesn't play there.
function usesSpace(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("button, a, select, summary, [role=button], [role=menuitem], [role=checkbox], [role=tab], input, textarea, [contenteditable=true]");
}

// Which command a key press is, or null.
export function shortcutFor(
  e: Pick<KeyboardEvent, "key" | "code" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey" | "target">,
  isMac: boolean,
): Command | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (mod && !e.altKey && !e.shiftKey) {
    if (e.key === "f" || e.key === "F" || e.code === "KeyF") return "find";
    if (e.key === "k" || e.key === "K" || e.code === "KeyK") return "palette";
    if (e.key === "," || e.code === "Comma") return "settings";
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
    if (digit) return `page-${Number(digit)}`;
    return null;
  }
  if ((e.key === " " || e.code === "Space") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    return isTyping(e.target) || usesSpace(e.target) ? null : "play";
  }
  return null;
}

// Put the cursor in this page's search box, if it has one. Returns false when not.
export function focusSearch(): boolean {
  const box = Array.from(document.querySelectorAll<HTMLInputElement>("[data-find]"))
    .find((el) => el.offsetParent !== null && !el.disabled);
  if (!box) return false;
  box.focus();
  box.select?.();
  return true;
}

// The shortcuts, in words, for Help → Keyboard shortcuts.
export function shortcutList(isMac = IS_MAC): { keys: string; what: string }[] {
  const mod = isMac ? "Cmd" : "Ctrl";
  return [
    { keys: `${mod} + K`, what: "Find anything: a page, project, track or action" },
    { keys: `${mod} + F`, what: "Jump to the search box" },
    { keys: `${mod} + ,`, what: "Open Settings" },
    { keys: `${mod} + 1, 2, 3…`, what: "Go to a page in the sidebar, counting from the top" },
    { keys: "Space", what: "Play or pause the song in the player" },
    { keys: "Esc", what: "Close a panel, menu or the open page" },
    { keys: isMac ? "Cmd + [   Cmd + ]" : "Alt + Left   Alt + Right", what: "Back and forward (or the mouse's side buttons)" },
    { keys: "Right-click", what: "More actions on a project or track" },
    { keys: `${mod} + W`, what: "Close the window (the app keeps running in the tray)" },
    { keys: `${mod} + Shift + N`, what: "Open or close the narrow window that sits beside your music program" },
  ];
}

// Shortcuts from the keyboard and from the menu bar, sent to the page's handlers.
export function useDesktopCommands(run: (cmd: Command) => void) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const exec = (cmd: Command) => {
      if (cmd === "find") { focusSearch(); return; }
      latest.current(cmd);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const cmd = shortcutFor(e, IS_MAC);
      if (!cmd) return;
      if (cmd === "find" && !document.querySelector("[data-find]")) return;
      e.preventDefault();
      exec(cmd);
    };
    window.addEventListener("keydown", onKey);
    const off = bridge()?.onMenuCommand?.((cmd: Command) => exec(cmd));
    return () => {
      window.removeEventListener("keydown", onKey);
      if (typeof off === "function") off();
    };
  }, []);
}

// Something open over the page (a dialog or a menu) handles its own Escape first.
function somethingOpen(): boolean {
  return !!document.querySelector("[aria-modal='true'], [role='menu']");
}

// Escape closes whatever is open on the page (a project, a track, a crate). Typing in a
// box keeps Escape for the box (it clears a search).
export function useEscapeToClose(onClose: (() => void) | null) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !latest.current) return;
      if (isTyping(e.target) || somethingOpen()) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ── copy ────────────────────────────────────────────────────────────────────

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    const viaApp = bridge()?.copyText;
    if (viaApp) return !!(await viaApp(text));
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── progress on the dock / taskbar icon ──────────────────────────────────────

// A fraction from 0 to 1 while something long runs, or null when nothing does.
export function useIconProgress(fraction: number | null) {
  const shown = fraction == null ? -1 : Math.round(Math.min(1, Math.max(0, fraction)) * 100) / 100;
  useEffect(() => { bridge()?.setProgress?.(shown); }, [shown]);
  useEffect(() => () => { bridge()?.setProgress?.(-1); }, []);
}

// ── drag and drop ───────────────────────────────────────────────────────────

export interface Dropped { path: string; kind: "folder" | "file" | "missing" }

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

// Files and folders dropped anywhere on the window. Returns true while something is
// being dragged over it, for the "drop it here" overlay.
export function useFileDrop(onDrop: (items: Dropped[]) => void, enabled = true): boolean {
  const [over, setOver] = useState(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (enabled) setOver(true);
    };
    const overIt = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();  // without this the window won't accept the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = enabled ? "copy" : "none";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (!enabled) return;
      const files = Array.from(e.dataTransfer?.files || []);
      const paths = files.map((f) => bridge()?.pathForFile?.(f) || (f as any).path || "").filter(Boolean);
      if (!paths.length) return;
      const kinds: Dropped[] = (await bridge()?.pathKinds?.(paths)) ?? paths.map((p: string) => ({ path: p, kind: "file" as const }));
      latest.current(kinds);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", overIt);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", overIt);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [enabled]);
  return over;
}

// The folder a path sits in (for a dropped file).
export function folderOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

// True when a folder is one of these, or sits inside one of them.
export function isInside(folder: string, parents: string[]): boolean {
  const norm = (x: string) => x.replace(/[\\/]+$/, "");
  const f = norm(folder);
  return parents.some((p) => {
    const q = norm(p);
    return f === q || f.startsWith(q + "/") || f.startsWith(q + "\\");
  });
}

export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// ── window glass ─────────────────────────────────────────────────────────────

// The window's see-through material: "vibrancy" (Mac), "mica" (Windows 11) or "none"
// (see windowMaterial in desktop.js). Shown as data-material on <html> so the sidebar
// only turns see-through when the desktop really is behind it.
export function windowMaterial(): "vibrancy" | "mica" | "none" {
  const m = typeof window !== "undefined" ? bridge()?.material : undefined;
  return m === "vibrancy" || m === "mica" ? m : "none";
}
if (typeof document !== "undefined" && windowMaterial() !== "none") {
  document.documentElement.dataset.material = windowMaterial();
}
