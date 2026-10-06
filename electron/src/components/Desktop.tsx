import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { copyText, shortcutList } from "../desktop";
import { Icon } from "./Icon";
import { useDialogFocus } from "./a11y";

// Everyday desktop pieces for the page. SHARED FILE: the same file lives in Backups
// and Uploader (electron/src/components/Desktop.tsx); change both together. Styles
// are in lazy-ui.css (.ctxmenu, .copybtn, .dropzone, .toast, .keys, .confirm), in both looks.

// ── pop-ups that fade out ────────────────────────────────────────────────────

const LEAVE_POP_MS = 140;  // --dur-quick in lazy-ui.css
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Close a pop-up with a short fade instead of in one frame: `leave(...)` marks it as
// leaving (put data-leaving on the scrim, see lazy-ui.css), then calls `close(...)` once
// the fade is done. With reduced motion it closes straight away.
export function useLeave<A extends unknown[]>(close: (...a: A) => void): [boolean, (...a: A) => void] {
  const [leaving, setLeaving] = useState(false);
  const going = useRef(false);
  const leave = (...a: A) => {
    if (going.current) return;
    if (reducedMotion()) { close(...a); return; }
    going.current = true;
    setLeaving(true);
    setTimeout(() => { going.current = false; setLeaving(false); close(...a); }, LEAVE_POP_MS);
  };
  return [leaving, leave];
}

// The same for a pop-up its parent shows and hides: wrap the condition,
// <Exit>{open && <Panel />}</Exit>, and the panel stays a moment after `open` goes
// false, marked data-leaving so its fade-out can play. It can't be clicked meanwhile.
export function Exit({ children }: { children: ReactNode }) {
  const last = useRef<ReactNode>(null);
  const [, redraw] = useState(0);
  if (children) last.current = children;
  const leaving = !children && last.current != null;
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => { last.current = null; redraw((n) => n + 1); }, reducedMotion() ? 0 : LEAVE_POP_MS);
    return () => clearTimeout(t);
  }, [leaving]);
  if (!children && !last.current) return null;
  return <div className="exit" data-leaving={leaving || undefined} {...(leaving ? { inert: "" } : {})}>{children || last.current}</div>;
}

// ── right-click menu ─────────────────────────────────────────────────────────

export type MenuItem =
  | { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }
  | "-";

type MenuState = { x: number; y: number; items: MenuItem[] } | null;
let menuState: MenuState = null;
const menuSubs = new Set<(m: MenuState) => void>();
const setMenu = (m: MenuState) => { menuState = m; menuSubs.forEach((f) => f(m)); };

// Open a right-click menu at the mouse. Use as onContextMenu={(e) => openMenu(e, items)}.
export function openMenu(e: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  const shown = items.filter((m, i, all) => m !== "-" || (i > 0 && i < all.length - 1 && all[i - 1] !== "-"));
  if (shown.length) setMenu({ x: e.clientX, y: e.clientY, items: shown });
}

// Rendered once in the app; shows whichever menu is open.
export function ContextMenuHost() {
  const [m, setM] = useState<MenuState>(menuState);
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => { menuSubs.add(setM); return () => { menuSubs.delete(setM); }; }, []);
  // keep the menu inside the window
  useLayoutEffect(() => {
    if (!m || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(m.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(m.y, window.innerHeight - r.height - 8)),
    });
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [m]);
  useEffect(() => {
    if (!m) return;
    const close = () => setMenu(null);
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
      const at = btns.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (at + 1) % btns.length : (at - 1 + btns.length) % btns.length;
      btns[next]?.focus();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [m]);
  if (!m) return null;
  return (
    <div ref={ref} className="ctxmenu" role="menu"
      style={pos ? { left: pos.left, top: pos.top, transformOrigin: `${m.x - pos.left}px ${m.y - pos.top}px` } : { left: m.x, top: m.y, visibility: "hidden" }}
      onContextMenu={(e) => e.preventDefault()}>
      {m.items.map((it, i) => it === "-"
        ? <div key={`sep${i}`} className="ctxmenu__sep" role="separator" />
        : (
          <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
            className={`ctxmenu__item${it.danger ? " ctxmenu__item--danger" : ""}`}
            onClick={() => { setMenu(null); it.onClick(); }}>{it.label}</button>
        ))}
    </div>
  );
}

// ── copy button ──────────────────────────────────────────────────────────────

// A small button that copies a path or link, and says so for a moment.
export function CopyButton({ text, what = "path", size = 14, className = "" }: {
  text: string; what?: string; size?: number; className?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);
  const label = done ? "Copied" : `Copy ${what}`;
  return (
    <button type="button" className={`iconbtn copybtn${done ? " copybtn--done" : ""} ${className}`.trim()}
      title={label} aria-label={label}
      onClick={async (e) => { e.preventDefault(); e.stopPropagation(); if (await copyText(text)) setDone(true); }}>
      <Icon name={done ? "check" : "copy"} size={size} />
    </button>
  );
}

// ── little messages along the bottom ─────────────────────────────────────────

// Up to three at once, newest in front and the older ones tucked just behind it.
// Pointing at the stack fans it out and holds every message until the pointer leaves.
// A message saying something went wrong gets the warning mark instead of the tick.
type Tone = "ok" | "warn";
type ToastMsg = { id: number; text: string; action?: { label: string; onClick: () => void }; tone: Tone };
let toastSeq = 0;
const toastSubs = new Set<(t: ToastMsg) => void>();
const MAX_TOASTS = 3;
const LEAVE_MS = 220;

// Show a one-line message for a few seconds, with an optional button.
export function toast(text: string, action?: ToastMsg["action"], tone: Tone = "ok") {
  const msg = { id: ++toastSeq, text, action, tone };
  toastSubs.forEach((f) => f(msg));
}

// The same, for something that went wrong (a failed backup, a folder that couldn't be added).
export function toastWarn(text: string, action?: ToastMsg["action"]) {
  toast(text, action, "warn");
}

type Shown = ToastMsg & { leaving?: boolean };

export function ToastHost() {
  const [list, setList] = useState<Shown[]>([]);
  const [held, setHeld] = useState(false);
  const leave = (id: number) => {
    setList((l) => l.map((m) => m.id === id ? { ...m, leaving: true } : m));
    setTimeout(() => setList((l) => l.filter((m) => m.id !== id)), LEAVE_MS);
  };
  useEffect(() => {
    const add = (m: ToastMsg) => setList((l) => [m, ...l.filter((x) => !x.leaving)].slice(0, MAX_TOASTS));
    toastSubs.add(add);
    return () => { toastSubs.delete(add); };
  }, []);
  // each message keeps its own few seconds, paused while the stack is pointed at
  const live = list.filter((m) => !m.leaving);
  useEffect(() => {
    if (held) return;
    const timers = live.map((m) => setTimeout(() => leave(m.id), (m.action || m.tone === "warn" ? 7000 : 3500)));
    return () => timers.forEach(clearTimeout);
  }, [held, live.map((m) => m.id).join()]);
  if (!list.length) return null;
  let depth = 0;
  return (
    <div className={`toasts${held ? " toasts--open" : ""}`} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
      {list.map((m) => {
        const i = m.leaving ? depth : depth++;
        return (
          <div className={`toast toast--${m.tone}${i > 0 ? " toast--back" : ""}`} role={m.tone === "warn" ? "alert" : "status"} key={m.id}
            data-leaving={m.leaving || undefined} aria-hidden={i > 0 && !held ? true : undefined}
            style={{ "--i": i, zIndex: MAX_TOASTS - i } as CSSProperties}>
            <Icon name={m.tone === "warn" ? "alert" : "check"} size={15} />
            <span className="toast__text">{m.text}</span>
            {m.action && (
              <button type="button" className="toast__btn" onClick={() => { leave(m.id); m.action!.onClick(); }}>{m.action.label}</button>
            )}
            <button type="button" className="iconbtn toast__x" aria-label="Dismiss" onClick={() => leave(m.id)}><Icon name="close" size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}

// ── "are you sure?" box ──────────────────────────────────────────────────────

type ConfirmOpts = { title: string; body?: string; confirm: string; cancel?: string; danger?: boolean };
type ConfirmState = (ConfirmOpts & { resolve: (ok: boolean) => void }) | null;
const confirmSubs = new Set<(c: ConfirmState) => void>();

// Ask before something that can't be undone, in the app's own look (instead of the
// computer's grey pop-up). Resolves true when the person presses the confirm button.
export function askConfirm(opts: ConfirmOpts): Promise<boolean> {
  if (!confirmSubs.size) return Promise.resolve(window.confirm(opts.body ? `${opts.title}\n\n${opts.body}` : opts.title));
  return new Promise((resolve) => confirmSubs.forEach((f) => f({ ...opts, resolve })));
}

export function ConfirmHost() {
  const [c, setC] = useState<ConfirmState>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { confirmSubs.add(setC); return () => { confirmSubs.delete(setC); }; }, []);
  const [leaving, leave] = useLeave((ok: boolean) => { c?.resolve(ok); setC(null); });
  const done = (ok: boolean) => leave(ok);
  useDialogFocus(ref, !!c);
  useEffect(() => {
    if (!c) return;
    // the safe choice has focus, so a stray Enter never deletes anything
    ref.current?.querySelector<HTMLButtonElement>(".confirm__cancel")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [c]);
  if (!c) return null;
  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={() => done(false)}>
      <div ref={ref} className={`wnew confirm${c.danger ? " confirm--danger" : ""}`} role="alertdialog" aria-modal="true"
        aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <div className="confirm__body">
          <h2 id="confirm-title">{c.title}</h2>
          {c.body && <p>{c.body}</p>}
        </div>
        <div className="confirm__foot">
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={() => done(false)}>{c.cancel ?? "Cancel"}</button>
          <button type="button" className={`btn ${c.danger ? "btn--danger" : "btn--primary"}`} onClick={() => done(true)}>{c.confirm}</button>
        </div>
      </div>
    </div>
  );
}

// ── drop zone ────────────────────────────────────────────────────────────────

// Covers the window while files are dragged over it.
export function DropZone({ show, title, hint }: { show: boolean; title: string; hint: string }) {
  if (!show) return null;
  return (
    <div className="dropzone" aria-hidden="true">
      <div className="dropzone__box">
        <Icon name="folder" size={34} />
        <div className="dropzone__title">{title}</div>
        <div className="dropzone__hint">{hint}</div>
      </div>
    </div>
  );
}

// ── Help → Keyboard shortcuts ────────────────────────────────────────────────

export function ShortcutsPanel({ onClose: close }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [leaving, onClose] = useLeave(close);
  useDialogFocus(ref);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={onClose}>
      <div ref={ref} className="wnew keys" role="dialog" aria-modal="true" aria-labelledby="keys-title" onClick={(e) => e.stopPropagation()}>
        <header className="wnew__head">
          <div className="wnew__heading">
            <div className="eyebrow">Help</div>
            <h2 id="keys-title">Keyboard shortcuts</h2>
          </div>
          <button type="button" className="wnew__close" aria-label="Close" onClick={onClose}><Icon name="close" size={14} /></button>
        </header>
        <div className="keys__list">
          {shortcutList().map((s) => (
            <div key={s.what} className="keys__row">
              <span className="keys__keys">{s.keys.split(/\s{3}/).map((k) => <kbd key={k}>{k}</kbd>)}</span>
              <span className="keys__what">{s.what}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Windows title bar ────────────────────────────────────────────────────────

// On Windows the window has no title bar of its own (see desktop.js): this strip
// takes its place in the app's colours. Dragging it moves the window and a
// double-click maximises (Windows handles both); the ☰ button opens the File, Edit,
// View, Window and Help menus. Windows draws minimise, maximise and close on the right.
export function TitleBar() {
  const b = (window as any).ablebackup || (window as any).lazyupload;
  const show = b?.platform === "win32" && typeof b?.openAppMenu === "function";
  useLayoutEffect(() => {
    document.body.classList.toggle("has-titlebar", show);
    return () => document.body.classList.remove("has-titlebar");
  }, [show]);
  if (!show) return null;
  return (
    <div className="titlebar">
      <button className="titlebar__menu" aria-label="Menu" title="Menu"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); b.openAppMenu(r.left, r.bottom + 2); }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
          <path d="M2 3.5h10M2 7h10M2 10.5h10" />
        </svg>
      </button>
    </div>
  );
}
