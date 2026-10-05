import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CopyButton } from "../components/Desktop";
import { makeApi } from "../api";
import type { LibraryItem, Snapshot, SnapshotDiff } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { fmtSize, dawLabel } from "../format";
import { parseStamp } from "./Crate/types";
import { Cover } from "../components/Cover";
import { PlayButton, SongWave } from "../components/Player";
import { coverColor, useLook } from "../look";
import { EmptyState } from "../components/SlothSpot";
import { GenreChip } from "../components/GenrePick";
import "../label.css";

const api = makeApi();

// Numbers on the project page are real, never vague.

const fmtD = (ms: number) =>
  ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT = (ms: number) =>
  ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// stable catalog number from the project's identity
function catalogNo(projectId: string): string {
  let h = 0;
  for (const c of projectId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `LCB-${String(h % 10000).padStart(4, "0")}`;
}

interface Ev { kind: "created" | "change" | "verified" | "attention"; when: number;
  what: string; delta: React.ReactNode; }

function Delta({ added, changed, removed }: { added: number; changed: number; removed: number }) {
  return (
    <>
      <span className="add">+{added} added</span> · <span className="mod">~{changed} modified</span> · <span className="del">-{removed} removed</span>
    </>
  );
}

export interface ProjectTab { key: string; label: string; count?: number; content: ReactNode; }

// The project page: a header with what it is and how it stands, tabs for its songs,
// backups, missing samples and history, and a column of plain facts on the right.
export function ProjectLabel({ item, onOpenInDaw, onReveal, onGenre, tabs, actions }: {
  item: LibraryItem; onOpenInDaw: () => void; onReveal: () => void; onGenre?: () => void; tabs: ProjectTab[]; actions?: ReactNode;
}) {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [diffs, setDiffs] = useState<Record<number, SnapshotDiff>>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSnaps([]); setDiffs({});
    api.projectDetail(item.name).then(async (d) => {
      if (!alive) return;
      setSnaps(d.snapshots);
      // diff the most recent backups against their predecessors (timeline depth cap)
      const recent = d.snapshots.slice(-8);
      const out: Record<number, SnapshotDiff> = {};
      await Promise.all(recent.map(async (s) => {
        try { out[s.id] = await api.snapshotDiff(s.id); } catch { /* no diff for this one */ }
      }));
      if (alive) setDiffs(out);
    }).catch(() => {});
    return () => { alive = false; };
  }, [item.project_id]);

  const cat = catalogNo(item.project_id);
  const crate = item.genre || "Untagged";
  const latest = snaps[snaps.length - 1];
  const first = snaps[0];
  const lastVerifiedSnap = [...snaps].reverse().find((s) => s.verified);
  const created = first ? parseStamp(first.timestamp) : (item.mtime ? item.mtime * 1000 : 0);
  const estYear = created ? new Date(created).getFullYear() : new Date().getFullYear();
  const warn = item.missing_count;

  const events = useMemo<Ev[]>(() => {
    const evs: Ev[] = [];
    const list = [...snaps].reverse(); // newest first
    for (const s of list) {
      const num = snaps.indexOf(s) + 1;
      const when = parseStamp(s.timestamp);
      if (s.missing && s.missing.length > 0) {
        evs.push({
          kind: "attention", when,
          what: `${s.missing.length} sample${s.missing.length === 1 ? "" : "s"} couldn't be found at backup time`,
          delta: <>{s.missing.slice(0, 2).map((m) => m.split("/").pop()).join(", ")}{s.missing.length > 2 ? ` and ${s.missing.length - 2} more` : ""}</>,
        });
      }
      const d = diffs[s.id];
      const changed = d?.available && !d.is_first && (d.added.length + d.changed.length + d.removed.length) > 0;
      evs.push({
        kind: s.verified ? "verified" : changed ? "change" : "verified",
        when,
        what: `Backup ${num}${s.verified ? ", checked" : ""}`,
        delta: changed
          ? <Delta added={d!.added.length} changed={d!.changed.length} removed={d!.removed.length} />
          : d?.available && !d.is_first
          ? <>identical to the previous backup</>
          : <>{s.file_count} file{s.file_count === 1 ? "" : "s"} · {fmtSize(s.total_size)}</>,
      });
    }
    if (first) {
      evs.push({
        kind: "created", when: parseStamp(first.timestamp),
        what: `First backed up`,
        delta: <>{first.file_count} file{first.file_count === 1 ? "" : "s"} · {fmtSize(first.total_size)}</>,
      });
    }
    return evs;
  }, [snaps, diffs]);

  // ── label data export (the screen's single blue CTA) ──
  function download(name: string, text: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
    setToast("Saved");
    setTimeout(() => setToast(null), 2600);
  }
  const labelData = () => ({
    exported: new Date().toISOString(),
    app: "LazyCreatives Backups",
    project: {
      name: item.name, catalog: cat, crate, created: created ? new Date(created).toISOString() : null,
      daw: dawLabel(item.daw), bpm: item.bpm ?? null, tracks: item.tracks ?? null,
      plugins: item.plugins ?? [], size_bytes: item.size, path: item.path,
      backups: item.snapshot_count,
      last_verified: lastVerifiedSnap ? new Date(parseStamp(lastVerifiedSnap.timestamp)).toISOString() : null,
      missing_count: warn,
      history: snaps.map((s, i) => ({
        backup: i + 1, timestamp: s.timestamp, verified: !!s.verified,
        files: s.file_count, size_bytes: s.total_size, missing: s.missing ?? [],
      })),
    },
  });
  function exportLabel() {
    download(`${cat}-label.json`, JSON.stringify(labelData(), null, 2), "application/json");
  }
  function exportLiner() {
    const L: string[] = [];
    L.push("LAZY CREATIVES — BACKUPS · LINER NOTES");
    L.push("=".repeat(46));
    L.push(`${item.name}  ·  ${cat}  ·  ${crate}`);
    L.push("");
    L.push(`first backed   ${first ? fmtDT(parseStamp(first.timestamp)) : "not yet"}  (${dawLabel(item.daw)})`);
    if (item.bpm) L.push(`bpm            ${Math.round(item.bpm)}${item.tracks ? ` · ${item.tracks} tracks` : ""}`);
    L.push(`size on disk   ${fmtSize(item.size)}${item.plugins?.length ? ` · plugins: ${item.plugins.join(", ")}` : ""}`);
    L.push(`backups        ${item.snapshot_count}${lastVerifiedSnap ? ` · last verified ${fmtDT(parseStamp(lastVerifiedSnap.timestamp))}` : ""}`);
    L.push(`missing        ${warn ? `${warn} sample${warn === 1 ? "" : "s"}` : "none — everything opens"}`);
    L.push("");
    L.push("THE STORY SO FAR");
    L.push("-".repeat(46));
    for (const s of snaps) {
      const i = snaps.indexOf(s) + 1;
      L.push(`${fmtDT(parseStamp(s.timestamp))}  Backup #${i}${s.verified ? " — verified" : ""}`);
      L.push(`${" ".repeat(19)}${s.file_count} files · ${fmtSize(s.total_size)}${s.missing?.length ? ` · ${s.missing.length} missing` : ""}`);
    }
    L.push("");
    L.push("You make the music. We handle the rest — and prove it's done.");
    download(`${cat}-liner-notes.txt`, L.join("\n"), "text/plain");
  }

  const [look] = useLook();
  const [tab, setTab] = useState<string>("");
  useEffect(() => setTab(""), [item.project_id]);
  const allTabs: ProjectTab[] = [
    ...tabs,
    { key: "history", label: "History", count: events.length ? snaps.length : undefined, content: (
      events.length > 0 ? (
        <>
          <p className="faint" style={{ margin: "0 0 14px", fontSize: 12.5 }}>Every backup is compared with the one before, so the project's whole life is on the record.</p>
          <ul className="tl">
            {events.map((e, i) => (
              <li key={i} className={e.kind}>
                <span className="when mono">{fmtDT(e.when)}</span>
                <div className="what">{e.what}</div>
                <span className="delta mono">{e.delta}</span>
              </li>
            ))}
          </ul>
        </>
      ) : <EmptyState pose="napping" title="No history yet">Back the project up and its story starts here.</EmptyState>
    ) },
  ];
  const active = allTabs.find((t) => t.key === tab) ?? allTabs[0];
  const meta = [crate !== "Untagged" ? crate : "", item.bpm ? `${Math.round(item.bpm)} BPM` : "",
    item.tracks ? `${item.tracks} tracks` : "", dawLabel(item.daw)].filter(Boolean).join(" · ");
  const facts: [string, ReactNode, string?][] = [
    ["Made in", dawLabel(item.daw)],
    ...(item.bpm || item.tracks ? [["Tempo · tracks",
      [item.bpm ? `${Math.round(item.bpm)} BPM` : "", item.tracks ? `${item.tracks} tracks` : ""].filter(Boolean).join(" · ")] as [string, string]] : []),
    ["Size on disk", `${fmtSize(item.size)}${latest ? ` · ${latest.file_count} files` : ""}`],
    ["First on record", created ? fmtD(created) : "—"],
    ["Backups", String(item.snapshot_count)],
    ["Last checked", lastVerifiedSnap ? fmtDT(parseStamp(lastVerifiedSnap.timestamp)) : "Never", lastVerifiedSnap ? "" : "faint"],
    ["Missing samples", warn ? `${warn}` : "None", warn ? "warn" : ""],
    ["Genre", onGenre
      ? <button type="button" className="linkbtn dl-genre" onClick={onGenre}
          title={item.genre_by_you ? "Set by you. Click to change" : "Guessed from tempo and name. Click to correct it"}>
          <span className={item.genre_by_you || !item.genre ? "" : "genre-guess"}>{crate}</span>
          <span className="faint">{item.genre ? (item.genre_by_you ? " · set by you" : " · guessed") : ""}</span>
        </button>
      : crate],
    ["Catalogue no.", cat],
  ];

  const song = item.latest_export ?? null;
  const songMeta = { title: song?.name ?? "", project: item.name, genre: item.genre };
  const tint = coverColor(item.genre, item.name);
  const statusText = warn > 0 ? <span className="warn-text">{warn} sample{warn === 1 ? "" : "s"} missing</span>
    : item.changed ? <span className="accent-text"><span className="dot dot--accent" /> changed since its last backup</span>
    : item.backed_up ? <span className="ok-text"><span className="dot dot--ok" /> safe, opens</span>
    : <span className="faint">not backed up yet</span>;
  const statusChip = warn > 0 ? <span className="fact-chip fact-chip--warn">{warn} sample{warn === 1 ? "" : "s"} missing</span>
    : item.changed ? <span className="fact-chip fact-chip--changed" title="Saved since its last backup; back it up to keep this version">● Saved since last backup</span>
    : item.backed_up ? <span className="fact-chip fact-chip--ok">● Safe, opens</span>
    : <span className="fact-chip">Not backed up yet</span>;

  const chip = onGenre && <GenreChip genre={item.genre ?? null} setByYou={!!item.genre_by_you} onClick={onGenre} />;
  return (
    <>
      {look === "sleeve" ? (
        <header className="proj-hero" style={{ ["--tint" as string]: tint }}>
          <div className="proj-hero__sleeve">
            {/* the spine, printed like a record's: catalogue number and title */}
            <span className="proj-hero__spine" aria-hidden="true"><b>{cat}</b>{item.name}</span>
            <Cover name={item.name} genre={item.genre} className="proj-hero__cover" label={false} />
          </div>
          <div className="proj-hero__text">
            <div className="eyebrow">{[crate !== "Untagged" ? `${crate} project` : "", dawLabel(item.daw)].filter(Boolean).join(" · ")}</div>
            <h1 className="proj-hero__name col-trunc" title={item.name}>{item.name}</h1>
            <div className="proj-hero__meta">
              {[item.bpm ? `${Math.round(item.bpm)} BPM` : "", item.tracks ? `${item.tracks} tracks` : "",
                created ? `started ${fmtD(created)}` : "", `${item.snapshot_count} backup${item.snapshot_count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
              {" · "}{statusText}
            </div>
            {chip && <div className="proj-hero__genre">{chip}</div>}
            <div className="proj-hero__actions">
              {song && <PlayButton path={song.path} title={song.name} meta={songMeta} size={48} className="playbtn--big" />}
              <Button variant="ghost" onClick={onOpenInDaw}>Open in {dawLabel(item.daw)}</Button>
              <Button variant="ghost" onClick={onReveal}><Icon name="folder" size={15} />Show in folder</Button>
              <CopyButton text={item.path} what="project path" size={15} className="copybtn--big" />
              {actions}
            </div>
          </div>
        </header>
      ) : (
        <>
          <header className="deck-head">
            <Cover name={item.name} genre={item.genre} size={124} label={false} />
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow deck-head__eyebrow" style={{ color: tint }}>{[crate !== "Untagged" ? `${crate} project` : "", dawLabel(item.daw)].filter(Boolean).join(" · ")}</div>
              <h1 className="col-trunc" title={item.name}>{item.name}</h1>
              {/* like the screen on a deck: tempo, tracks, size, backups */}
              <div className="deckread">
                <span className="deckread__cell"><small>BPM</small><b>{item.bpm ? Math.round(item.bpm) : "–"}</b></span>
                <span className="deckread__cell"><small>Tracks</small><b>{item.tracks || "–"}</b></span>
                <span className="deckread__cell"><small>Size</small><b>{fmtSize(item.size)}</b></span>
                <span className="deckread__cell"><small>Backups</small><b>{item.snapshot_count}</b></span>
              </div>
              <div className="fact-chips">
                {statusChip}
                {chip}
              </div>
            </div>
            <div className="page-head__actions">
              <Button variant="ghost" onClick={onReveal}><Icon name="folder" size={15} />Show in folder</Button>
              <CopyButton text={item.path} what="project path" size={15} className="copybtn--big" />
              <Button variant="ghost" onClick={onOpenInDaw}>Open in {dawLabel(item.daw)}</Button>
              {actions}
            </div>
          </header>
          <div className="deck">
            {song ? (
              <>
                <PlayButton path={song.path} title={song.name} meta={songMeta} size={46} className="playbtn--big" />
                <div style={{ minWidth: 0 }}>
                  <div className="deck__title"><b className="col-trunc">{song.name}</b><span className="faint">latest song · exported {fmtDT(song.mtime * 1000)}</span></div>
                  <SongWave path={song.path} meta={songMeta} height={52} />
                </div>
              </>
            ) : (
              <>
                <span className="deck__empty-icon"><Icon name="music" size={18} /></span>
                <div className="faint" style={{ fontSize: 13 }}>No song exported from this project yet. When you export one, its waveform shows up here and you can play it.</div>
              </>
            )}
          </div>
        </>
      )}

      <div className="proj-grid">
        <div style={{ minWidth: 0 }}>
          <div className="tabs" role="tablist">
            {allTabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={t === active}
                className={`tab${t === active ? " tab--on" : ""}`} onClick={() => setTab(t.key)}>
                {t.label}{t.count != null && <span className="tab__count">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="tabpanel" role="tabpanel">{active.content}</div>
        </div>

        <aside className="proj-aside">
          {look === "crate" && <div className="lvinyl" aria-hidden>
            <div className="vlabel-disc" style={{ background: tint }}>
              <div className="vl-top">
                <span className="lc mono">LAZY CREATIVES</span>
                <h2 className={item.name.length > 18 ? "vl-name vl-name--long" : "vl-name"}>{item.name}</h2>
              </div>
              <span className="hole" />
              <div className="vl-bottom">
                <span className="cat mono">{cat}</span>
                <span className="rpm mono">est. {estYear}</span>
              </div>
            </div>
          </div>}
          <dl className="dl">
            {facts.map(([k, v, c]) => (
              <div key={k}><dt>{k}</dt><dd className={c === "warn" ? "warn-text" : c === "faint" ? "faint" : ""}>{v}</dd></div>
            ))}
          </dl>
          {!!item.plugins?.length && (
            <div>
              <div className="faint" style={{ fontSize: 12.5, marginBottom: 7 }}>Plugins</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {item.plugins.map((pl) => <span key={pl} className="tag">{pl}</span>)}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button variant="quiet" size="sm" onClick={exportLiner} title="A plain text page with the project's facts and history">Save liner notes</Button>
            <Button variant="quiet" size="sm" onClick={exportLabel} title="The same facts as a data file">Save label data</Button>
          </div>
        </aside>
      </div>

      <div className={`ltoast${toast ? " ltoast--show" : ""}`} role="status">{toast ?? ""}</div>
    </>
  );
}
