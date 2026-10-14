// Plugins: every plug-in installed on this computer, the formats it comes in, where
// it lives and how many of your projects use it, laid out as one big card per
// maker; open a card for that maker's plug-ins. Read-only: nothing is loaded,
// moved or removed. Backups looks in the usual plug-in folders for Windows, Mac and
// Linux, plus any folders you add at the bottom of the page.
import { useEffect, useMemo, useState } from "react";
import { makeApi } from "../api";
import type { MissingPlugin, PluginFormat, PluginList, PluginRow } from "../types";
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
const NO_MAKER = "Maker not known";
// What "Show" picks: every plugin, the ones your projects use or
// don't, or the plug-ins your projects use that aren't on this computer (a flat list:
// their maker isn't known).
type Use = "any" | "used" | "unused" | "missing";
type Kind = "all" | PluginRow["kind"];
type SortKey = "name" | "used";
type PlugSort = { key: SortKey; dir: 1 | -1 };
// Name A to Z unless you click "Used in"; kept between launches.
const SORT_KEY = "lc-plugins-sort";
const ORDER_KEY = "lc-plugins-cards";
const DEFAULT_SORT: PlugSort = { key: "name", dir: 1 };
const isSort = (v: any) => !!v && ["name", "used"].includes(v.key) && (v.dir === 1 || v.dir === -1);
const KIND_WORD: Record<PluginRow["kind"], string> = { Instrument: "Instrument", Effect: "Effect", "": "Type not known" };
// A to Z ignoring case, "Plugin 2" before "Plugin 10".
const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
export function sortPlugins(rows: PluginRow[], { key, dir }: PlugSort): PluginRow[] {
  return [...rows].sort((a, b) => (key === "used" ? (a.used_in - b.used_in) * dir : text(a.name, b.name) * dir) || text(a.name, b.name));
}
// One card per maker: how many plugins, how many are instruments and effects, and how
// many your projects use. Most used first (then most plugins, then A to Z), or A to Z;
// "Maker not known" always last.
export type MakerCard = { maker: string; count: number; instruments: number; effects: number; used: number };
export function makerCards(rows: PluginRow[], order: "used" | "name" = "used"): MakerCard[] {
  const m = new Map<string, MakerCard>();
  for (const p of rows) {
    const k = p.maker || NO_MAKER;
    const c = m.get(k) ?? { maker: k, count: 0, instruments: 0, effects: 0, used: 0 };
    c.count++;
    if (p.kind === "Instrument") c.instruments++;
    if (p.kind === "Effect") c.effects++;
    if (p.used_in > 0) c.used++;
    m.set(k, c);
  }
  return [...m.values()].sort((a, b) => (a.maker === NO_MAKER ? 1 : 0) - (b.maker === NO_MAKER ? 1 : 0)
    || (order === "used" ? b.used - a.used || b.count - a.count : 0) || text(a.maker, b.maker));
}

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
  const [kind, setKind] = useState<Kind>("all");
  const [use, setUse] = useState<Use>("any");
  const [sort, setSortState] = useState<PlugSort>(() => recall<PlugSort>(SORT_KEY, DEFAULT_SORT, isSort));
  const [open, setOpen] = useState<string | null>(null);
  // The maker card opened ("" = the cards), and how the cards are ordered (kept between launches).
  const [maker, setMakerState] = useState("");
  const [order, setOrderState] = useState<"used" | "name">(() => recall<"used" | "name">(ORDER_KEY, "used", (v) => v === "used" || v === "name"));
  const setOrder = (o: "used" | "name") => { keep(ORDER_KEY, o); setOrderState(o); };
  const chooseMaker = (m: string) => { setMakerState(m); setOpen(null); window.scrollTo?.({ top: 0 }); };

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
  const kinds = (["Instrument", "Effect", ""] as PluginRow["kind"][]).filter((k) => k || list.some((p) => !p.kind));
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  // Everything but the maker: the cards are made from this.
  const matching = useMemo(() => list.filter((p) =>
    (format === "all" || p.formats.includes(format))
    && (kind === "all" || p.kind === kind)
    && (use === "any" || use === "missing" || (use === "used" ? p.used_in > 0 : p.used_in === 0))
    && words.every((w) => `${p.name} ${p.maker} ${p.kind}`.toLowerCase().includes(w))), [list, format, kind, use, q]);
  const cards = useMemo(() => makerCards(matching, order), [matching, order]);
  const pickedMaker = maker;
  // A search looks through every maker.
  const oneMaker = pickedMaker && !searching ? pickedMaker : "";
  const shown = useMemo(() => sortPlugins(oneMaker ? matching.filter((p) => (p.maker || NO_MAKER) === oneMaker) : matching, sort),
    [matching, oneMaker, sort]);
  const missing = data?.missing ?? [];
  const missingShown = useMemo(() => {
    const rows = missing.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)));
    return [...rows].sort((a, b) => (sort.key === "used" ? (a.used_in - b.used_in) * sort.dir : text(a.name, b.name) * sort.dir) || text(a.name, b.name));
  }, [missing, q, sort]);
  const showMissing = use === "missing";
  const filtered = searching || format !== "all" || kind !== "all";
  const sortBy = (key: SortKey) => setSortState((s) => {
    const n: PlugSort = s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "used" ? -1 : 1 };
    keep(SORT_KEY, n); return n;
  });
  const noProjects = !!data && data.projects_scanned === 0;
  const usedCount = list.filter((p) => p.used_in > 0).length;
  const SHOW: [Use, string, number][] = [
    ["any", "All plugins", list.length],
    ...(noProjects ? [] : [["used", "Used in your projects", usedCount], ["unused", "Never used", list.length - usedCount],
      ["missing", "Missing from this computer", missing.length]] as [Use, string, number][]),
  ];
  const pickUse = (u: Use) => { setUse(u); setOpen(null); };

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

  const usedCell = (p: PluginRow) => (
    <span className={`col-num${p.used_in ? "" : " faint"}`} title={p.used_by.length ? `Used in ${p.used_by.join(", ")}${p.used_in > p.used_by.length ? "…" : ""}` : undefined}>
      {noProjects ? "—" : p.used_in ? plural(p.used_in, "project") : "Not used"}
    </span>
  );
  const row = (p: PluginRow) => {
    const isOpen = open === p.id;
    const toggle = () => setOpen(isOpen ? null : p.id);
    // under the name: who makes it (when more than one maker is on show) and what it is
    const sub = [oneMaker ? "" : p.maker || NO_MAKER, KIND_WORD[p.kind]].filter(Boolean).join(" · ");
    return (
      <div key={p.id} className={`plug-item${isOpen ? " plug-item--open" : ""}`}>
        <div className="row cols plug-row plug-cols" role="button" tabIndex={0}
          aria-expanded={isOpen} aria-label={`${p.name}, ${sub}`} onClick={toggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
          {look === "crate"
            ? <span className="stripe plug-stripe" data-kind={p.kind} />
            : <span className="plug-tile" data-kind={p.kind} aria-hidden>{initials(p.name)}</span>}
          <div className="plug-name">
            <div className="lib-name col-trunc" title={p.name}>{p.name}</div>
            <div className="plug-sub col-trunc" title={sub}>
              <span className="plug-dot" data-kind={p.kind} aria-hidden />{sub}
            </div>
          </div>
          <span className="plug-formats">
            {p.formats.map((f) => <span key={f} className="tag plug-fmt" data-format={f} title={FORMAT_HELP[f]}>{f}</span>)}
          </span>
          {usedCell(p)}
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

  // A plug-in your projects use that isn't here: its name and how many projects use it;
  // open it for those projects.
  const missingRow = (p: MissingPlugin) => {
    const isOpen = open === `missing:${p.id}`;
    const toggle = () => setOpen(isOpen ? null : `missing:${p.id}`);
    return (
      <div key={p.id} className={`plug-item${isOpen ? " plug-item--open" : ""}`}>
        <div className="row cols plug-row plug-miss-cols" role="button" tabIndex={0}
          aria-expanded={isOpen} onClick={toggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
          {look === "crate"
            ? <span className="stripe plug-stripe plug-stripe--missing" title="Not on this computer" />
            : <span className="plug-tile plug-tile--missing" aria-hidden>{initials(p.name)}</span>}
          <div className="lib-name col-trunc" title={p.name}>{p.name}</div>
          <span className="col-num" title={`Used in ${p.used_by.join(", ")}${p.used_in > p.used_by.length ? "…" : ""}`}>
            {plural(p.used_in, "project")}
          </span>
          <Icon name="chevronDown" size={14} className="plug-chev" />
        </div>
        {isOpen && (
          <div className="plug-detail plug-detail--one">
            <div className="plug-detail__col">
              <div className="eyebrow">Used in</div>
              <div className="plug-used">
                {p.used_by.map((n) => <button key={n} className="tag plug-proj" onClick={() => onOpenProject(n)} title={`Open ${n}`}>{n}</button>)}
                {p.used_in > p.used_by.length && <span className="faint">and {fmtCount(p.used_in - p.used_by.length)} more</span>}
              </div>
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
  // A maker's card: the name, how many plugins, a bar of instruments (blue) and effects
  // (green), and how many your projects use. Click it to see that maker's plugins.
  const card = (c: MakerCard) => {
    const pct = (n: number) => `${(n / Math.max(1, c.count)) * 100}%`;
    const kinds = [c.instruments ? plural(c.instruments, "instrument") : "", c.effects ? plural(c.effects, "effect") : ""].filter(Boolean).join(" · ") || "Type not known";
    return (
      <button key={c.maker} className={`plug-card${c.maker === NO_MAKER ? " plug-card--none" : ""}`} onClick={() => chooseMaker(c.maker)}
        aria-label={`${c.maker}: ${plural(c.count, "plugin")}, ${kinds}${noProjects ? "" : `, ${fmtCount(c.used)} used in your projects`}`}>
        <span className="plug-card__name col-trunc" title={c.maker}>{c.maker}</span>
        <span className="plug-card__n">{plural(c.count, "plugin")}</span>
        <span className="plug-card__bar" aria-hidden>
          <i data-kind="Instrument" style={{ width: pct(c.instruments) }} /><i data-kind="Effect" style={{ width: pct(c.effects) }} />
        </span>
        <span className="plug-card__kinds col-trunc">{kinds}</span>
        {!noProjects && <span className={`plug-card__used${c.used ? "" : " faint"}`}>{c.used ? `${fmtCount(c.used)} used in your projects` : "None used in your projects"}</span>}
      </button>
    );
  };
  const listView = showMissing || searching || !!pickedMaker;
  const title = showMissing ? "Missing from this computer" : searching ? "Search results" : pickedMaker || "Makers";
  const count = showMissing ? <>{plural(missing.length, "plugin")} your projects use that {missing.length === 1 ? "isn't" : "aren't"} here</>
    : listView ? plural(shown.length, "plugin")
    : <>{plural(cards.length, "maker")} · {plural(matching.length, "plugin")}</>;

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
                <input type="search" placeholder={`Search ${plural(list.length, "plugin")} or makers…`} value={q} aria-label="Search plugins" spellCheck={false} data-find
                  onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
                {q && <button className="lib-search__x" aria-label="Clear search" onClick={() => setQ("")}><Icon name="close" size={13} /></button>}
              </label>
              {!showMissing && <div className="seg" role="group" aria-label="Type">
                {(["all", ...kinds] as Kind[]).map((k) => (
                  <button key={k || "none"} className={`seg__opt${kind === k ? " seg__opt--on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {k === "all" ? "All" : k === "Instrument" ? "Instruments" : k === "Effect" ? "Effects" : "Not known"}
                  </button>
                ))}
              </div>}
            </div>
            <div className="lib-find__row">
              {!noProjects && (
                <select className={use !== "any" ? "lib-pick lib-pick--on" : "lib-pick"} value={use} aria-label="Show" onChange={(e) => pickUse(e.target.value as Use)}>
                  {SHOW.map(([u, label, n]) => <option key={u} value={u}>{label} ({fmtCount(n)})</option>)}
                </select>
              )}
              {!showMissing && (
                <select className={format !== "all" ? "lib-pick lib-pick--on" : "lib-pick"} value={format} aria-label="Format" onChange={(e) => setFormat(e.target.value as PluginFormat | "all")}>
                  <option value="all">Every format</option>
                  {formats.map((f) => <option key={f} value={f}>{FORMAT_HELP[f]}</option>)}
                </select>
              )}
              {!listView && (
                <div className="seg seg--sm" role="group" aria-label="Order of the makers">
                  <button className={`seg__opt${order === "used" ? " seg__opt--on" : ""}`} aria-pressed={order === "used"} onClick={() => setOrder("used")}>Most used first</button>
                  <button className={`seg__opt${order === "name" ? " seg__opt--on" : ""}`} aria-pressed={order === "name"} onClick={() => setOrder("name")}>A to Z</button>
                </div>
              )}
              {(filtered || use !== "any") && (
                <button className="lib-find__clear" onClick={() => { setQ(""); setFormat("all"); setKind("all"); setUse("any"); }}>
                  <Icon name="close" size={12} />Clear all
                </button>
              )}
            </div>
          </div>

          <div className="plug-main__head">
            {pickedMaker && !searching && !showMissing && (
              <button className="btn btn--ghost btn--sm plug-back" onClick={() => chooseMaker("")}>
                <Icon name="chevronLeft" size={14} />All makers
              </button>
            )}
            <h2 className="plug-main__title col-trunc" title={title}>{title}</h2>
            <span className="plug-main__count">{count} · looked {fmtDay(data.scanned_at * 1000, { time: true })}</span>
          </div>
          {showMissing ? (
            !missing.length ? (
              <EmptyState pose="thumbs-up" title="Nothing missing">Every plugin your projects use is on this computer.</EmptyState>
            ) : !missingShown.length ? (
              <EmptyState pose="searching" title="No plugins match">Try fewer words, or clear the search.</EmptyState>
            ) : (
              <>
                <div className={`table plug-table plug-missing${look === "crate" ? " table--crate" : ""}`}>
                  <div className="row cols cols-head plug-miss-cols">
                    <span />
                    {sortButton("name", "Plugin")}
                    {sortButton("used", "Used in", " col-num")}
                    <span />
                  </div>
                  {missingShown.map(missingRow)}
                </div>
                {!data.complete && <p className="faint plug-note">Backups couldn't look through every plugin folder, so some of these may be on this computer after all.</p>}
              </>
            )
          ) : !(listView ? shown.length : cards.length) ? (
            <EmptyState pose="searching" title="No plugins match">Try fewer words, or clear the filters.</EmptyState>
          ) : !listView ? (
            <div className="plug-cards">{cards.map(card)}</div>
          ) : (
            <div className={`table plug-table${look === "crate" ? " table--crate" : ""}`}>
              <div className="row cols cols-head plug-cols">
                <span />
                {sortButton("name", "Plugin")}
                <span>Formats</span>
                {sortButton("used", "Used in", " col-num")}
                <span />
              </div>
              {shown.map(row)}
            </div>
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
