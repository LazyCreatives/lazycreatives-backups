// "Tidy names": rename one song's project versions, its folder and its exported songs
// together, with a side-by-side preview. Nothing changes until Rename, and the
// project page offers Undo afterwards.
import { useEffect, useMemo, useRef, useState } from "react";
import { makeApi } from "../api";
import type { LibraryItem, TidyDone, TidyGroup, TidyOptions, TidyPlan, TidyRow } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import "../tidy.css";

const api = makeApi();

const KIND_LABEL: Record<TidyRow["kind"], string> = { folder: "Folder", version: "Version", song: "Song" };

function stemOf(name: string, kind: TidyRow["kind"]): string {
  if (kind === "folder") return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
function extOf(name: string, kind: TidyRow["kind"]): string {
  if (kind === "folder") return "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

export function TidyNames({ items, onClose, onDone }: {
  items: LibraryItem[]; onClose: () => void; onDone: (r: TidyDone) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [style, setStyle] = useState<"v" | "v0">("v");
  const [numbers, setNumbers] = useState<"keep" | "order">("keep");
  const [songStyle, setSongStyle] = useState<"paren" | "dash">("paren");
  const [folder, setFolder] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useMemo(() => items.map((i) => i.project_id), [items]);

  const opts = (): TidyOptions => ({ project_ids: ids, names, style, numbers, song_style: songStyle, folder,
    overrides, skip: [...skip] });

  // re-preview a moment after each change (typing a name shouldn't fire every key)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.tidyPreview(opts()).then((p) => { if (alive) { setPlan(p); setErr(null); } })
        .catch((e) => { if (alive) setErr(e.message || "Couldn't work out the new names."); });
    }, plan ? 220 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [ids.join(","), JSON.stringify(names), style, numbers, songStyle, folder, JSON.stringify(overrides), [...skip].join("|")]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function rename() {
    setBusy(true); setErr(null);
    try { onDone(await api.tidyApply(opts())); }
    catch (e: any) { setErr(e.message || "Rename failed. Nothing was changed."); }
    finally { setBusy(false); }
  }

  const toggle = (p: string) => setSkip((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const groups = plan?.groups ?? [];
  const count = plan?.count ?? 0;
  const many = groups.length > 1;
  const title = many ? `${groups.length} songs` : groups[0]?.name ?? items[0]?.name ?? "";

  return (
    <div className="wnew__scrim" onClick={() => !busy && onClose()}>
      <div className="wnew tidy" role="dialog" aria-modal="true" aria-labelledby="tidy-title" onClick={(e) => e.stopPropagation()}>
        <header className="wnew__head">
          <div className="wnew__heading">
            <div className="eyebrow">Tidy names</div>
            <h2 id="tidy-title" className="col-trunc">{title}</h2>
          </div>
          <button type="button" className="wnew__close" aria-label="Close" onClick={onClose} disabled={busy}>✕</button>
        </header>

        <div className="tidy__opts">
          {!many && groups[0] && (
            <label className="field tidy__name">
              <span>Song name</span>
              <input type="text" value={names[groups[0].id] ?? groups[0].name} spellCheck={false}
                onChange={(e) => setNames({ ...names, [groups[0].id]: e.target.value })} />
            </label>
          )}
          <div className="field">
            <span>Numbers</span>
            <div className="seg" role="group" aria-label="Which number each version gets">
              <button type="button" className={`seg__opt${numbers === "keep" ? " seg__opt--on" : ""}`} onClick={() => setNumbers("keep")}
                title="Keep the version numbers already in the names, and fill in the rest">Keep yours</button>
              <button type="button" className={`seg__opt${numbers === "order" ? " seg__opt--on" : ""}`} onClick={() => setNumbers("order")}
                title="Number them 1, 2, 3 from the oldest save">Count from 1</button>
            </div>
          </div>
          <div className="field">
            <span>Style</span>
            <div className="seg" role="group" aria-label="How versions are numbered">
              <button type="button" className={`seg__opt${style === "v" ? " seg__opt--on" : ""}`} onClick={() => setStyle("v")}>Name v2</button>
              <button type="button" className={`seg__opt${style === "v0" ? " seg__opt--on" : ""}`} onClick={() => setStyle("v0")}>Name v02</button>
            </div>
          </div>
          <div className="field">
            <span>Songs</span>
            <div className="seg" role="group" aria-label="How exported songs are named">
              <button type="button" className={`seg__opt${songStyle === "paren" ? " seg__opt--on" : ""}`} onClick={() => setSongStyle("paren")}>Name v2 (master)</button>
              <button type="button" className={`seg__opt${songStyle === "dash" ? " seg__opt--on" : ""}`} onClick={() => setSongStyle("dash")}>Name v2 - master</button>
            </div>
          </div>
          <label className="tidy__check">
            <input type="checkbox" checked={folder} onChange={(e) => setFolder(e.target.checked)} />
            Rename the project folder too
          </label>
        </div>

        <div className="tidy__list">
          <div className="tidy__row tidy__row--head" aria-hidden>
            <span /><span>What</span><span>Now</span><span>After</span>
          </div>
          {!plan && !err && <div className="tidy__empty faint">Working out the new names…</div>}
          {groups.map((g) => (
            <Group key={g.id} g={g} many={many} name={names[g.id] ?? g.name}
              onName={(v) => setNames({ ...names, [g.id]: v })}
              overrides={overrides} onOverride={(p, v) => setOverrides({ ...overrides, [p]: v })}
              skip={skip} onToggle={toggle} />
          ))}
        </div>

        {err && <div className="tidy__err" role="alert"><Icon name="alert" size={14} /> {err}</div>}
        <footer className="tidy__foot">
          <p className="tidy__safe">
            <Icon name="lock" size={13} />
            <span>Only these names change. Samples, recordings, Backup folders and what's inside your project files are never touched. <b>Undo</b> puts every name back.</span>
          </p>
          <div className="tidy__btns">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={rename} disabled={busy || count === 0}>
              {busy ? "Renaming…" : count === 0 ? "Nothing to rename" : `Rename ${count} ${count === 1 ? "item" : "items"}`}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Group({ g, many, name, onName, overrides, onOverride, skip, onToggle }: {
  g: TidyGroup; many: boolean; name: string; onName: (v: string) => void;
  overrides: Record<string, string>; onOverride: (path: string, v: string) => void;
  skip: Set<string>; onToggle: (path: string) => void;
}) {
  return (
    <section className="tidy__group">
      {many && (
        <div className="tidy__ghead">
          <input type="text" aria-label="Song name" value={name} spellCheck={false} onChange={(e) => onName(e.target.value)} />
          <span className="faint">{g.versions} version{g.versions === 1 ? "" : "s"} · {g.songs} song{g.songs === 1 ? "" : "s"}</span>
        </div>
      )}
      {g.rows.map((r) => <Row key={r.old} r={r} override={overrides[r.old]} onOverride={(v) => onOverride(r.old, v)}
        off={skip.has(r.old)} onToggle={() => onToggle(r.old)} />)}
    </section>
  );
}

function Row({ r, override, onOverride, off, onToggle }: {
  r: TidyRow; override?: string; onOverride: (v: string) => void; off: boolean; onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const can = r.status === "rename" || r.status === "skipped" || r.status === "blocked";
  const changes = r.status === "rename";
  const what = r.kind === "version" ? `Version ${r.version}` : KIND_LABEL[r.kind];
  const ext = extOf(r.new_name, r.kind);
  return (
    <div className={`tidy__row tidy__row--${r.status}${r.kind === "folder" ? " tidy__row--folder" : ""}`}>
      <span>
        {can && <input type="checkbox" checked={!off} aria-label={`Rename ${r.old_name}`} onChange={onToggle} />}
      </span>
      <span className="tidy__what">
        <Icon name={r.kind === "folder" ? "folder" : r.kind === "song" ? "music" : "disc"} size={13} />{what}
      </span>
      <span className="tidy__now col-trunc mono" title={r.old}>{r.old_name}</span>
      <span className="tidy__after">
        {changes || r.status === "blocked" ? (
          <span className="tidy__edit">
            <input ref={ref} type="text" className="mono" spellCheck={false} aria-label={`New name for ${r.old_name}`}
              value={override ?? stemOf(r.new_name, r.kind)} onChange={(e) => onOverride(e.target.value)} />
            {ext && <span className="tidy__ext mono">{ext}</span>}
          </span>
        ) : (
          <span className="tidy__same mono col-trunc">{r.status === "skipped" ? "keeps its name" : r.new_name}</span>
        )}
        {r.status === "same" && <span className="tidy__tag tidy__tag--ok">already right</span>}
        {r.uploaded && <span className="tidy__tag" title="Uploader follows the new name, so its SoundCloud link stays">on SoundCloud · stays linked</span>}
        {r.note && <span className={`tidy__note${r.status === "blocked" ? " warn-text" : ""}`}>{r.note}</span>}
      </span>
    </div>
  );
}
