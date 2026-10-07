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
import { baseName } from "../desktop";
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
type SortKey = "name" | "maker" | "used";

const plural = (n: number, w: string) => `${fmtCount(n)} ${w}${n === 1 ? "" : "s"}`;
const reveal = (p: string) => (window as any).ablebackup?.revealPath?.(p);
const NO_MAKER = "Maker not known";
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [open, setOpen] = useState<string | null>(null);

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
    const by = (p: PluginRow) => sort.key === "used" ? p.used_in : (sort.key === "maker" ? (p.maker || "￿") : p.name).toLowerCase();
    return [...rows].sort((a, b) => {
      const x = by(a), y = by(b);
      return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * sort.dir;
    });
  }, [list, q, format, use, sort]);
  const filtered = !!q.trim() || format !== "all" || use !== "any";
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "used" ? -1 : 1 }));
  const noProjects = !!data && data.projects_scanned === 0;
  const fmtVar = { "--fmts": Math.max(1, formats.length) } as CSSProperties;
  // Sleeve: one shelf per maker, like a label's catalogue; Crate: one long list.
  const groups = useMemo(() => {
    if (look !== "sleeve") return [];
    const m = new Map<string, PluginRow[]>();
    for (const p of shown) { const k = p.maker || NO_MAKER; m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()].sort(([a], [b]) => (a === NO_MAKER ? 1 : b === NO_MAKER ? -1 : a.localeCompare(b, undefined, { sensitivity: "base" })));
  }, [shown, look]);

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
        <div className={`row cols plug-row plug-cols${look === "sleeve" ? " plug-cols--grouped" : ""}`} role="button" tabIndex={0}
          aria-expanded={isOpen} onClick={toggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
          {look === "crate"
            ? <span className="stripe plug-stripe" data-kind={p.kind} title={p.kind || undefined} />
            : <span className="plug-tile" data-kind={p.kind} aria-hidden>{initials(p.name)}</span>}
          <div style={{ minWidth: 0 }}>
            <div className="lib-name col-trunc" title={p.name}>{p.name}</div>
            {p.kind && <div className="lib-sub col-trunc">{p.kind}</div>}
          </div>
          {look === "crate" && <span className={`col-trunc${p.maker ? "" : " faint"}`} title={p.maker || undefined}>{p.maker || "—"}</span>}
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

  const head = (
    <div className={`row cols cols-head plug-cols${look === "sleeve" ? " plug-cols--grouped" : ""}`}>
      <span />
      {([["name", "Plugin", ""], ...(look === "crate" ? [["maker", "Maker", ""]] : []), ["", "Formats", ""], ["used", "Used in", " col-num"], ["", "Where", ""]] as [SortKey | "", string, string][]).map(([k, label, cls]) => {
        if (!k) return <span key={label} className={cls}>{label}</span>;
        const on = sort.key === k;
        return (
          <button key={k} className={`lib-sort${cls}${on ? " lib-sort--on" : ""}`} onClick={() => sortBy(k)} aria-pressed={on} title={`Sort by ${label.toLowerCase()}`}>
            {label}{on && <Icon name={sort.dir === 1 ? "arrowUp" : "arrowDown"} size={11} />}
          </button>
        );
      })}
      <span />
    </div>
  );


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
          ) : look === "crate" ? (
            <div className="table table--crate plug-table" style={fmtVar}>{head}{shown.map(row)}</div>
          ) : (
            groups.map(([maker, rows], i) => (
              <section key={maker} className="plug-shelf">
                <div className="plug-shelf__head">
                  <h2 className={maker === NO_MAKER ? "faint" : undefined}>{maker}</h2>
                  <span className="faint">{plural(rows.length, "plugin")}</span>
                </div>
                <div className="table plug-table" style={fmtVar}>{i === 0 && head}{rows.map(row)}</div>
              </section>
            ))
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
