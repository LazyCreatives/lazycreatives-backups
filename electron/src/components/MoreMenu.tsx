import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface MoreItem { label: string; onClick: () => void; disabled?: boolean }

// The "···" menu on a row or a project's page: the less common actions, out of the way
// (the same actions are on right-click). From the keyboard: Enter/Space on ··· opens it
// with the first item focused, Up/Down move, Home/End jump, Escape or Tab closes it and
// focus goes back to the ··· button.

export function MoreMenu({ items, name, button = false }: {
  items: MoreItem[]; name: string;
  button?: boolean;  // a full-size "··· More" button (a page's head) rather than a row's small ···
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const close = (refocus: boolean) => { setOpen(false); if (refocus) btnRef.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("mousedown", onDown); };
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "Tab") { close(false); return; }
    const btns = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!btns.length) return;
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at + 1) % btns.length
      : e.key === "ArrowUp" ? (at - 1 + btns.length) % btns.length
      : e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault(); e.stopPropagation();
    btns[next].focus();
  };
  return (
    <div ref={ref} className={`lib-menu${open ? " lib-menu--open" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} type="button" className={button ? "btn btn--ghost moremenu__btn" : "iconbtn"} aria-label={`More actions for ${name}`}
        title={button ? "More actions (or right-click the page's top)" : undefined} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}><Icon name="more" size={button ? 15 : undefined} />{button && "More"}</button>
      {open && (
        <div ref={listRef} className="lib-menu__list" role="menu" aria-label={`More actions for ${name}`} onKeyDown={onKey}>
          {items.map((m) => (
            <button key={m.label} role="menuitem" className="lib-menu__item" disabled={m.disabled}
              onClick={() => { close(true); m.onClick(); }}>{m.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
