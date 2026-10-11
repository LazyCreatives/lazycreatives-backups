// Plugins: every plug-in installed on this computer, the formats it comes in, where
// it lives and how many of your projects use it. Read-only: nothing is loaded,
// moved or removed. Backups looks in the usual plug-in folders for Windows, Mac and
// Linux, plus any folders you add at the bottom of the page.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { makeApi } from "../api";
import type { PluginFormat, PluginList, PluginRow } from "../types";
import { PageHeader } from "../components/PageHeader";
import { Icon } from "../components/Icon";
import { EmptyState } from "../components/SlothSpot";
import { CopyButton, toast } from "../components/Desktop";
import { useLook } from "../look";
import { fmtCount, fmtDay, shortPath } from "../format";
import { baseName, keep, recall } from "../desktop";
import "../plugins.css";

const api = makeApi();
const ALL_FORMATS: PluginFormat[] = ["VST3", "AU", "CLAP", "VST2", "AAX", "LV2"];
const FORMAT_HELP: Record<PluginFormat, string> = {
  VST3: "VST3: works in most music programs",
  AU: "Audio Unit: Mac only, used by Logic Pro and GarageBand (and others)",
  CLAP: "CLAP: the newer open format (Bitwig, Reaper, Studio One, FL Studio)",
  VST2: "VST2: the older VST format",
  AAX: "AAX: Pro Tools only",
  LV2: "LV2: mostly on Linux",
};
type Use = "any" | "used" | "unused";
type SortKey = "name" | "used";
type PlugSort = { key: SortKey; dir: 1 | -1 };
// Inside each folder: name A to Z unless you click "Used in"; kept between launches.
const SORT_KEY = "lc-plugins-sort";
const DEFAULT_SORT: PlugSort = { key: "name", dir: 1 };
const isSort = (v: any) => !!v && ["name", "used"].includes(v.key) && (v.dir === 1 || v.dir === -1);
// The folders: one per maker (A to Z, unknown last), and inside it one per type
// (instruments, effects, then unknown), like folders in a file browser.
const KINDS: [PluginRow["kind"], string][] = [["Instrument", "Instruments"], ["Effect", "Effects"], ["", "Type not known"]];
const OPEN_KEY = "lc-plugins-open";
// A to Z ignoring case, "Plugin 2" before "Plugin 10".
const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
export function sortPlugins(rows: PluginRow[], { key, dir }: PlugSort): PluginRow[] {
  return [...rows].sort((a, b) => (key === "used" ? (a.used_in - b.used_in) * dir : text(a.name, b.name) * dir) || text(a.name, b.name));
}
export type PluginTree = { maker: string; kinds: { kind: PluginRow["kind"]; label: string; rows: PluginRow[] }[]; count: number }[];
export function pluginTree(rows: PluginRow[]): PluginTree {
  const m = new Map<string, PluginRow[]>();
  for (const p of rows) { const k = p.maker || NO_MAKER; m.set(k, [...(m.get(k) ?? []), p]); }
  return [...m.entries()]
    .sort(([a], [b]) => (a === NO_MAKER ? 1 : b === NO_MAKER ? -1 : text(a, b)))
    .map(([maker, list]) => ({
      maker, count: list.length,
      kinds: KINDS.map(([kind, label]) => ({ kind, label, rows: list.filter((p) => (KINDS.some(([k]) => k === p.kind) ? p.kind : "") === kind) }))
        .filter((k) => k.rows.length),
    }));
}

const NO_MAKER = "Maker not known";
const plural = (n: number, w: string) => `${fmtCount(n)} ${w}${n === 1 ? "" : "s"}`;
const reveal = (p: string) => (window as any).ablebackup?.revealPath?.(p);
// "Pro-Q 3" -> "PQ", "Serum" -> "SE": the letters on a plug-in's tile in the Sleeve look.
export function initials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? name).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

export function Plugins({ onOpenProject }: { onOpenProject: (name: string) => void }) {
  const [look] = useLook();
  const [data, setData] = useState<PluginList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [format, setFormat] = useState<PluginFormat | "all">("all");
  const [use, setUse] = useState<Use>("any");
  const [sort, setSortState] = useState<PlugSort>(() => recall<PlugSort>(SORT_KEY, DEFAULT_SORT, isSort));
  const [open, setOpen] = useState<string | null>(null);
  // Which maker and type folders are open (all closed at first), kept between launches.
  const [folders, setFoldersState] = useState<string[]>(() => recall<string[]>(OPEN_KEY, [], Array.isArray));
  const setFolders = (f: string[]) => { keep(OPEN_KEY, f); setFoldersState(f); };

  async function load(refresh = false) {
    setBusy(true); setErr(null);
    try { setData(await api.plugins(refresh)); }
    catch (e: any) { setErr(e.message || "Couldn't look in your plugin folders."); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  const yours = (data?.folders ?? []).filter((f) => f.yours).map((f) => f.path);
  async function saveFolders(folders: string[], said: string) {
    setBusy(true);
    try { setData(await api.setPluginFolders(folders)); toast(said); }
    catch (e: any) { setErr(e.message || "Couldn't save that folder."); }
    finally { setBusy(false); }
  }
  async function addFolder() {
    const dir = await (window as any).ablebackup?.pickFolder?.();
    if (dir && !yours.includes(dir)) saveFolders([...yours, dir], `Added ${baseName(dir)}. Backups looked in it for plugins.`);
  }

  const list = data?.plugins ?? [];
  const formats = ALL_FORMATS.filter((f) => list.some((p) => p.formats.includes(f)));
  const countBy = (f: PluginFormat | "all") => (f === "all" ? list.length : list.filter((p) => p.formats.includes(f)).length);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = list.filter((p) =>
      (format === "all" || p.formats.includes(format))
      && (use === "any" || (use === "used" ? p.used_in > 0 : p.used_in === 0))
      && words.every((w) => `${p.name} ${p.maker} ${p.kind}`.toLowerCase().includes(w)));
    return sortPlugins(rows, sort);
  }, [list, q, format, use, sort]);
  const filtered = !!q.trim() || format !== "all" || use !== "any";
  const sortBy = (key: SortKey) => setSortState((s) => {
    const n: PlugSort = s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "used" ? -1 : 1 };
    keep(SORT_KEY, n); return n;
  });
  const noProjects = !!data && data.projects_scanned === 0;
  const fmtVar = { "--fmts": Math.max(1, formats.length) } as CSSProperties;
  const tree = useMemo(() => pluginTree(shown), [shown]);
  // While searching or filtering, every folder with a match is open.
  const isOpen = (key: string) => filtered || folders.includes(key);
  const toggleFolder = (key: string) => setFolders(folders.includes(key) ? folders.filter((k) => k !== key) : [...folders, key]);
  const allKeys = tree.flatMap((t) => [t.maker, ...t.kinds.map((k) => `${t.maker}/${k.kind}`)]);
  const allOpen = allKeys.every((k) => folders.includes(k));

  const header = (
    <PageHeader title="Plugins"
      subtitle="Every plugin on this computer, the formats it comes in, and which of your projects use it."
      actions={<>
        <button className="btn" onClick={addFolder} disabled={busy}><Icon name="plus" size={14} />Add folder</button>
        <button className="btn btn--primary" onClick={() => load(true)} disabled={busy}>
          <Icon name="refresh" size={14} />{busy && data ? "Looking…" : "Look again"}
        </button>
      </>} />
  );

  if (!data) {
    return (
      <div>
        {header}
        {err
          ? <EmptyState pose="tangled" title="Couldn't look in your plugin folders" action={<button className="btn btn--primary" onClick={() => load(true)}>Try again</button>}>{err}</EmptyState>
          : <EmptyState pose="searching" title="Looking in your plugin folders…">This takes a few seconds the first time.</EmptyState>}
      </div>
    );
  }

  const row = (p: PluginRow) => {
    const isOpen = open === p.id;
    const toggle = () => setOpen(isOpen ? null : p.id);
    return (
      <div key={p.id} className={`plug-item${isOpen ? " plug-item--open" : ""}`}>
        <div className="row cols plug-row plug-cols" role="button" tabIndex={0}
          aria-expanded={isOpen} onClick={toggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
          {look === "crate"
            ? <span className="stripe plug-stripe" data-kind={p.kind} title={p.kind || undefined} />
            : <span className="plug-tile" data-kind={p.kind} aria-hidden>{initials(p.name)}</span>}
          <div className="lib-name col-trunc" title={p.name}>{p.name}</div>
          <span className="plug-formats">
            {formats.map((f) => p.formats.includes(f)
              ? <span key={f} className="tag plug-fmt" data-format={f} title={FORMAT_HELP[f]}>{f}</span>
              : <span key={f} className="plug-fmt plug-fmt--none" aria-hidden />)}
          </span>
          <span className={`col-num${p.used_in ? "" : " faint"}`} title={p.used_by.length ? `Used in ${p.used_by.join(", ")}${p.used_in > p.used_by.length ? "…" : ""}` : undefined}>
            {noProjects ? "—" : p.used_in ? plural(p.used_in, "project") : "Not used"}
          </span>
          <span className="col-trunc faint plug-where" title={p.places[0]?.path}>{shortPath(p.places[0]?.path ?? "", 3)}</span>
          <Icon name="chevronDown" size={14} className="plug-chev" />
        </div>
        {isOpen && (
          <div className="plug-detail">
            <div className="plug-detail__col">
              <div className="eyebrow">Where it is</div>
              {p.places.map((pl) => (
                <div key={pl.path} className="plug-place">
                  <span className="tag plug-fmt" data-format={pl.format}>{pl.format}</span>
                  <span className="col-wrap2" title={pl.path}>{pl.path}</span>
                  <CopyButton text={pl.path} size={13} />
                  <button className="btn btn--ghost btn--sm" onClick={() => reveal(pl.path)}>Show in folder</button>
                </div>
              ))}
            </div>
            <div className="plug-detail__col">
              <div className="eyebrow">Used in</div>
              {noProjects ? <p className="faint plug-note">Scan your projects in the Library to see which ones use it.</p>
                : !p.used_by.length ? <p className="faint plug-note">None of your scanned projects use it.</p>
                : <div className="plug-used">
                    {p.used_by.map((n) => <button key={n} className="tag plug-proj" onClick={() => onOpenProject(n)} title={`Open ${n}`}>{n}</button>)}
                    {p.used_in > p.used_by.length && <span className="faint">and {fmtCount(p.used_in - p.used_by.length)} more</span>}
                  </div>}
            </div>
          </div>
        )}
      </div>
    );
  };

  const sortButton = (k: SortKey, label: string, cls = "") => {
    const on = sort.key === k;
    return (
      <button key={k} className={`lib-sort${cls}${on ? " lib-sort--on" : ""}`} onClick={() => sortBy(k)} aria-pressed={on}
        aria-label={on ? `${label}, sorted ${sort.dir === 1 ? "up" : "down"}` : undefined} title={`Sort by ${label.toLowerCase()}`}>
        {label}{on && <Icon name={sort.dir === 1 ? "arrowUp" : "arrowDown"} size={11} />}
      </button>
    );
  };
  const head = (
    <div className="row cols cols-head plug-cols">
      <span />
      {sortButton("name", "Plugin")}
      <span>Formats</span>
      {sortButton("used", "Used in", " col-num")}
      <span>Where</span>
      <span />
    </div>
  );
  const folderRow = (key: string, level: 1 | 2, name: string, count: number, faint: boolean) => {
    const on = isOpen(key);
    const toggle = () => { if (!filtered) toggleFolder(key); };
    return (
      <div className={`row plug-dir plug-dir--${level}${on ? " plug-dir--open" : ""}`} role="button" tabIndex={0} aria-expanded={on}
        aria-label={`${name}, ${plural(count, "plugin")}`} onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
        <Icon name="chevronRight" size={14} className="plug-dir__chev" />
        <Icon name="folder" size={level === 1 ? 17 : 15} className="plug-dir__icon" />
        <span className={`plug-dir__name col-trunc${faint ? " faint" : ""}`} title={name}>{name}</span>
        <span className="plug-dir__n faint">{plural(count, "plugin")}</span>
      </div>
    );
  };



  return (
    <div className="plugins">
      {header}
      {err && <p className="plug-err" role="alert"><Icon name="alert" size={14} /> {err}</p>}
      {!list.length ? (
        <EmptyState pose="searching" title="No plugins found"
          action={<button className="btn btn--primary" onClick={addFolder}><Icon name="plus" size={14} />Add a plugin folder</button>}>
          Backups looked in the usual plugin folders on this computer. If yours are kept somewhere else, add that folder.
        </EmptyState>
      ) : (
        <>
          <div className="lib-find">
            <div className="lib-find__top">
              <label className="lib-search">
                <Icon name="search" size={15} />
                <input type="search" placeholder="Search plugins or makers…" value={q} aria-label="Search plugins" spellCheck={false} data-find
                  onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
                {q && <button className="lib-search__x" aria-label="Clear search" onClick={() => setQ("")}><Icon name="close" size={13} /></button>}
              </label>
              <div className="seg" role="group" aria-label="Format">
                {(["all", ...formats] as (PluginFormat | "all")[]).map((f) => (
                  <button key={f} className={`seg__opt${format === f ? " seg__opt--on" : ""}`} onClick={() => setFormat(f)}
                    title={f === "all" ? undefined : FORMAT_HELP[f]}>
                    {f === "all" ? "All" : f} <span className="lib-find__n">{fmtCount(countBy(f))}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="lib-find__row">
              {!noProjects && (
                <select className={use !== "any" ? "lib-pick lib-pick--on" : "lib-pick"} value={use} aria-label="Used in your projects"
                  onChange={(e) => setUse(e.target.value as Use)}>
                  <option value="any">Used or not</option>
                  <option value="used">Used in your projects</option>
                  <option value="unused">Not used in any project</option>
                </select>
              )}
              <span className="lib-find__count">
                {filtered ? <>Showing <b>{fmtCount(shown.length)}</b> of {plural(list.length, "plugin")}</> : plural(list.length, "plugin")}
                {" · "}looked {fmtDay(data.scanned_at * 1000, { time: true })}
              </span>
              {filtered && (
                <button className="lib-find__clear" onClick={() => { setQ(""); setFormat("all"); setUse("any"); }}>
                  <Icon name="close" size={12} />Clear all
                </button>
              )}
            </div>
          </div>

          {!shown.length ? (
            <EmptyState pose="searching" title="No plugins match">Try fewer words, or clear the filters.</EmptyState>
          ) : (
            <>
              {!filtered && (
                <div className="plug-tree-bar">
                  <button className="btn btn--ghost btn--sm" onClick={() => setFolders(allOpen ? [] : allKeys)}>
                    <Icon name={allOpen ? "chevronUp" : "chevronDown"} size={13} />{allOpen ? "Close all folders" : "Open all folders"}
                  </button>
                </div>
              )}
              <div className={`table plug-table plug-tree${look === "crate" ? " table--crate" : ""}`} style={fmtVar}>
                {head}
                {tree.map((t) => (
                  <div key={t.maker} className="plug-group">
                    {folderRow(t.maker, 1, t.maker, t.count, t.maker === NO_MAKER)}
                    {isOpen(t.maker) && t.kinds.map((k) => {
                      const key = `${t.maker}/${k.kind}`;
                      return (
                        <div key={key} className="plug-group plug-group--kind" data-kind={k.kind}>
                          {folderRow(key, 2, k.label, k.rows.length, !k.kind)}
                          {isOpen(key) && k.rows.map(row)}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <section className="section plug-folders">
        <div className="section__head">
          <h2>Where Backups looks</h2>
          <button className="btn btn--sm" onClick={addFolder} disabled={busy}><Icon name="plus" size={13} />Add folder</button>
        </div>
        <div className="table">
          {data.folders.map((f) => (
            <div key={f.path} className="row cols plug-folder">
              <Icon name="folder" size={15} className="faint" />
              <span className="col-trunc" title={f.path}>{f.path}</span>
              <span className="faint">{f.yours ? "Your folder" : "Usual place"}</span>
              <span className="col-num">{f.exists ? plural(f.count, "plugin") : "Can't find this folder"}</span>
              {f.yours
                ? <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => saveFolders(yours.filter((y) => y !== f.path), `Stopped looking in ${baseName(f.path)}.`)}>Remove</button>
                : <span />}
            </div>
          ))}
          {!data.folders.length && <div className="row faint">None of the usual plugin folders are on this computer. Add the folder your plugins are in.</div>}
        </div>
        {!data.complete && <p className="faint plug-note">There were too many files to look through them all. Add the exact folders your plugins are in to see the rest.</p>}
      </section>
    </div>
  );
}
