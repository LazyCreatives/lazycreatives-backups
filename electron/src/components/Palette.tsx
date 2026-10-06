import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { useLeave } from "./Desktop";
import { useDialogFocus } from "./a11y";
import { fuzzyScore } from "../fuzzy";
import { Cover } from "./Cover";

// Cmd/Ctrl + K: one box to jump anywhere. Type part of a page, project, track, crate
// or action and press Enter. Each app hands over its own list (see App.tsx); the
// shortcut for a thing is shown beside it, so people learn them as they go.
// SHARED FILE: the same file lives in Backups and Uploader
// (electron/src/components/Palette.tsx); change both together.

export interface PaletteItem {
  id: string;
  group: string;        // "Go to", "Actions", "Projects"… shown as headings, in the order given
  label: string;
  hint?: string;        // a quiet second line: genre, BPM, where it is
  keys?: string;        // its shortcut, in words ("Cmd + 2")
  icon?: IconName;
  colour?: string;      // a genre colour for the little square
  cover?: { name: string; genre?: string | null };  // a project's or track's cover instead
  words?: string[];     // other words it should be found by
  quiet?: boolean;      // only shown once something is typed (a long list of projects)
  run: () => void;
}

const subs = new Set<(open: boolean) => void>();
export function openPalette() { subs.forEach((f) => f(true)); }

const PER_GROUP = 6;

// What to show for the typed text: best matches first inside each group.
export function paletteResults(items: PaletteItem[], q: string): PaletteItem[] {
  const query = q.trim();
  const order = [...new Set(items.map((i) => i.group))];
  const out: PaletteItem[] = [];
  for (const g of order) {
    let list = items.filter((i) => i.group === g);
    if (query) {
      list = list
        .map((it, n) => ({ it, n, s: fuzzyScore(query, [it.label, ...(it.words ?? [])]) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.n - b.n)
        .map((x) => x.it);
    } else list = list.filter((i) => !i.quiet);
    out.push(...list.slice(0, PER_GROUP));
  }
  return out;
}

export function PaletteHost({ items }: { items: () => PaletteItem[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { subs.add(setOpen); return () => { subs.delete(setOpen); }; }, []);
  if (!open) return null;
  return <Palette items={items()} onClose={() => setOpen(false)} />;
}

function Palette({ items, onClose: close }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const [leaving, onClose] = useLeave(close);
  useDialogFocus(ref);
  const shown = useMemo(() => paletteResults(items, q), [items, q]);
  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const go = (it: PaletteItem | undefined) => { if (!it) return; close(); setTimeout(it.run, 0); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === "Enter") { e.preventDefault(); go(shown[at]); return; }
    const n = shown.length;
    if (!n) return;
    const next = e.key === "ArrowDown" ? (at + 1) % n : e.key === "ArrowUp" ? (at - 1 + n) % n
      : e.key === "PageDown" ? Math.min(n - 1, at + 5) : e.key === "PageUp" ? Math.max(0, at - 5) : -1;
    if (next < 0) return;
    e.preventDefault();
    setAt(next);
  };
  let lastGroup = "";
  return (
    <div className="wnew__scrim palette__scrim" data-leaving={leaving || undefined} onClick={onClose}>
      <div ref={ref} className="wnew palette" role="dialog" aria-modal="true" aria-label="Find anything" onClick={(e) => e.stopPropagation()}>
        <label className="palette__box">
          <Icon name="search" size={17} />
          <input type="text" value={q} autoFocus spellCheck={false} placeholder="Go to a page, project or action…"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown[at] ? `pal-${at}` : undefined}
            aria-label="Find anything" onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <kbd>Esc</kbd>
        </label>
        <div ref={list} id="palette-list" className="palette__list" role="listbox" aria-label="Results">
          {shown.length === 0 && <div className="palette__none">Nothing called “{q.trim()}”. Try fewer letters.</div>}
          {shown.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.id} role="presentation">
                {head && <div className="palette__group" role="presentation">{head}</div>}
                <div id={`pal-${i}`} data-i={i} role="option" aria-selected={i === at}
                  className={`palette__item${i === at ? " palette__item--on" : ""}`}
                  onMouseMove={() => { if (i !== at) setAt(i); }} onClick={() => go(it)}>
                  {it.cover ? <Cover name={it.cover.name} genre={it.cover.genre} size={26} label={false} />
                    : <span className="palette__icon" style={it.colour ? { background: it.colour } : undefined}>
                      {!it.colour && <Icon name={it.icon ?? "chevronRight"} size={15} />}
                    </span>}
                  <span className="palette__text">
                    <span className="palette__label">{it.label}</span>
                    {it.hint && <span className="palette__hint">{it.hint}</span>}
                  </span>
                  {it.keys && <span className="palette__keys">{it.keys.split(" + ").map((k) => <kbd key={k}>{k}</kbd>)}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span>
        </div>
      </div>
    </div>
  );
}
