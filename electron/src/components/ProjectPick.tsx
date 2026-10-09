import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LibraryItem } from "../types";
import { fuzzyScore } from "../fuzzy";
import { fmtDay } from "../format";
import { Icon } from "./Icon";

// Pick the project a song came from, on "Songs not matched yet". A long plain list
// of hundreds of names was hard to use, so this is a box you type in: the best
// guesses for the song sit on top (why each, in a few words), then every project,
// narrowed as you type (typos allowed, see fuzzy.ts). Projects that share a name
// show their folder and when they were last saved so the right one can be told apart.
// Styles: .ppick in library.css, in both looks.

export type Guess = { project_id: string; why: string };

const folderOf = (dir: string) => dir.split(/[\\/]/).filter(Boolean).slice(-2).join(" / ");

export function ProjectPick({ items, value, guesses, song, onPick }: {
  items: LibraryItem[]; value: string; guesses: Guess[]; song: string; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.project_id, i])), [items]);
  // names used by more than one project get a folder + date hint
  const twins = useMemo(() => {
    const n: Record<string, number> = {};
    for (const i of items) { const k = i.name.trim().toLowerCase(); n[k] = (n[k] ?? 0) + 1; }
    return n;
  }, [items]);
  const twin = (i: LibraryItem) => (twins[i.name.trim().toLowerCase()] ?? 0) > 1;

  type Opt = { item: LibraryItem; why?: string; head?: string };
  const opts: Opt[] = useMemo(() => {
    const top = guesses.filter((g) => byId[g.project_id]).map((g) => ({ item: byId[g.project_id], why: g.why }));
    const rest = items
      .map((i) => ({ i, s: fuzzyScore(q, [i.name]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (q ? b.s - a.s : 0) || a.i.name.localeCompare(b.i.name, undefined, { numeric: true, sensitivity: "base" }));
    if (q.trim()) {
      const hit = top.filter((t) => fuzzyScore(q, [t.item.name]) > 0);
      const ids = new Set(hit.map((t) => t.item.project_id));
      return [...hit.map((t, n) => ({ ...t, head: n === 0 ? "Best guesses" : undefined })),
        ...rest.filter((x) => !ids.has(x.i.project_id)).map((x, n) => ({ item: x.i, head: n === 0 ? "Matching projects" : undefined }))];
    }
    return [...top.map((t, n) => ({ ...t, head: n === 0 ? "Best guesses" : undefined })),
      ...rest.map((x, n) => ({ item: x.i, head: n === 0 ? "All projects" : undefined }))];
  }, [items, guesses, byId, q]);

  function place() {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 420);
    const left = Math.min(r.left, window.innerWidth - width - 12);
    const up = r.bottom + 380 > window.innerHeight && r.top > 380;
    setPos({ left: Math.max(12, left), top: up ? r.top - 6 : r.bottom + 6, width, up });
  }
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const move = () => place();
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", move);
    window.addEventListener("scroll", move, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", move);
      window.removeEventListener("scroll", move, true);
    };
  }, [open]);
  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-n="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  function choose(id: string) {
    onPick(id);
    setOpen(false); setQ("");
    btn.current?.focus();
  }
  function key(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setAt((n) => Math.min(n + 1, opts.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (opts[at]) choose(opts[at].item.project_id); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
  }

  const cur = value ? byId[value] : undefined;
  return (
    <>
      <button ref={btn} type="button" className={`ppick__btn${cur ? " ppick__btn--on" : ""}`}
        aria-haspopup="listbox" aria-expanded={open} aria-label={`Project for ${song}`}
        onClick={() => setOpen((v) => !v)}>
        <span className="ppick__cur">
          {cur ? <>{cur.name}{twin(cur) && <span className="ppick__hint"> · {fmtDay(cur.mtime * 1000)}</span>}</> : "Pick a project…"}
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && pos && (
        <div ref={panel} className="ppick" role="dialog" aria-label={`Pick the project ${song} came from`}
          style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
          <div className="ppick__find">
            <Icon name="search" size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key}
              placeholder="Type a project name" aria-label="Find a project" role="combobox"
              aria-expanded aria-controls="ppick-list" aria-activedescendant={opts[at] ? `ppick-${at}` : undefined} />
          </div>
          <div ref={list} id="ppick-list" className="ppick__list" role="listbox">
            {opts.length === 0 && <div className="ppick__none">No project is called anything like “{q}”.</div>}
            {opts.map((o, n) => (
              <div key={`${o.head ?? ""}${o.item.project_id}${o.why ? "g" : ""}`}>
                {o.head && <div className="ppick__head">{o.head}</div>}
                <div id={`ppick-${n}`} data-n={n} role="option" aria-selected={o.item.project_id === value}
                  className={`ppick__opt${n === at ? " ppick__opt--at" : ""}${o.item.project_id === value ? " ppick__opt--on" : ""}`}
                  onMouseEnter={() => setAt(n)} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o.item.project_id)}>
                  <span className="ppick__name">{o.item.name}</span>
                  <span className="ppick__meta">
                    {[o.why, twin(o.item) ? `${folderOf(o.item.dir)} · saved ${fmtDay(o.item.mtime * 1000)}` : ""].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
