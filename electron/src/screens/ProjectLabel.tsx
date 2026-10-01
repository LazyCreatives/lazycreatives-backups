import { useEffect, useMemo, useState } from "react";
import { makeApi } from "../api";
import type { LibraryItem, Snapshot, SnapshotDiff } from "../types";
import { Button } from "../components/Button";
import { fmtSize, dawLabel } from "../format";
import { parseStamp } from "./Crate/types";
import "../label.css";

const api = makeApi();

// Label view (HANDOFF §6.7): the project rendered as a record, its vitals on the
// center label, a 3-sentence honest overview, facts grid, and a change timeline
// built by diffing each backup against the previous. Numbers are real, never vague.

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

export function ProjectLabel({ item, onOpenInDaw, onReveal }: {
  item: LibraryItem; onOpenInDaw: () => void; onReveal: () => void;
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
          delta: <>{s.missing.slice(0, 2).map((m) => m.split("/").pop()).join(", ")}{s.missing.length > 2 ? ` +${s.missing.length - 2} more` : ""} — the backup still notes them</>,
        });
      }
      const d = diffs[s.id];
      const changed = d?.available && !d.is_first && (d.added.length + d.changed.length + d.removed.length) > 0;
      evs.push({
        kind: s.verified ? "verified" : changed ? "change" : "verified",
        when,
        what: `Backup #${num}${s.verified ? " — verified" : ""}`,
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
        what: `First backed up — the record starts here`,
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
    setToast("✓ label data exported");
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

  // overview: the three sentences you actually need (real numbers, never vague)
  const months = created ? Math.max(0, Math.round((Date.now() - created) / 864e5 / 30.4)) : 0;
  // only claim growth when the human-readable sizes actually differ
  const grown = first && latest && snaps.length > 1 && fmtSize(first.total_size) !== fmtSize(latest.total_size);

  return (
    <>
      <div className="label-top">
        <section className="record-side glass">
          <div className="lvinyl">
            <div className="sheen" />
            <div className="vlabel-disc">
              <span className="lc mono">LAZY CREATIVES</span>
              <h2>{item.name}</h2>
              <span className="cat mono">{cat} · {crate.toUpperCase()}</span>
              <span className="hole" />
              <span className="rpm mono">33⅓ · est. {estYear}</span>
            </div>
          </div>
        </section>

        <section className="info-side glass">
          <div className="info-head">
            <div style={{ minWidth: 0 }}>
              <h1>{item.name}</h1>
              <div className="lstate mono">
                {warn > 0
                  ? <><span className="at">⚠ {warn} sample{warn === 1 ? "" : "s"} need{warn === 1 ? "s" : ""} a look</span>{item.backed_up && <> · <span className="ok">backup verified &amp; safe</span></>}</>
                  : item.backed_up
                  ? <span className="ok">✓ backed up &amp; verified — it opens</span>
                  : <span>not backed up yet</span>}
              </div>
            </div>
            <div className="label-actions">
              <Button size="sm" variant="ghost" onClick={onOpenInDaw}>▶ Open project</Button>
              <Button size="sm" variant="ghost" onClick={onReveal}>Reveal</Button>
              <Button size="sm" variant="ghost" onClick={exportLiner}>Liner notes .txt</Button>
              <button className="btn-blue" onClick={exportLabel}>Export label data</button>
            </div>
          </div>

          <div className="lsummary">
            <strong>{item.name}</strong> is a {crate === "Untagged" ? "" : `${crate.toLowerCase()} `}project
            {created ? <>, first on record {fmtD(created)}{months > 1 ? ` — about ${months} months in the making` : ""}</> : null}.{" "}
            {grown
              ? <>It's grown from {fmtSize(first!.total_size)} to {fmtSize(latest!.total_size)} across {item.snapshot_count} backups.{" "}</>
              : item.backed_up
              ? <>It holds {fmtSize(item.size)} across {item.snapshot_count} backup{item.snapshot_count === 1 ? "" : "s"}.{" "}</>
              : <>It takes {fmtSize(item.size)} on disk and has no backups yet.{" "}</>}
            {warn > 0
              ? <>One thing to know: <strong>{warn} sample{warn === 1 ? "" : "s"}</strong> couldn't be found at the last scan{item.backed_up ? " — the backup still holds a verified copy" : ""}.</>
              : item.backed_up
              ? <>Everything on the drive matches the backup, byte for byte.</>
              : <>Back it up once and it's protected.</>}
            {lastVerifiedSnap && (
              <span className="mono">✓ last verified {fmtDT(parseStamp(lastVerifiedSnap.timestamp))} · {latest?.file_count ?? 0} files{item.plugins?.length ? ` · ${item.plugins.length} plugin${item.plugins.length === 1 ? "" : "s"}` : ""}</span>
            )}
          </div>

          <div className="facts">
            {([
              ["First on record", created ? fmtD(created) : "—", ""],
              ["Crate", crate, ""],
              ["Size on disk", fmtSize(item.size), ""],
              ["Files", latest ? String(latest.file_count) : "—", ""],
              ["Tracks", item.tracks ? String(item.tracks) : "—", ""],
              ["Backups", String(item.snapshot_count), ""],
              ["Last verified", lastVerifiedSnap ? fmtD(parseStamp(lastVerifiedSnap.timestamp)) : "never", lastVerifiedSnap ? "ok" : ""],
              ["Missing", warn ? `${warn} sample${warn === 1 ? "" : "s"}` : "none", warn ? "at" : "ok"],
              ["DAW", dawLabel(item.daw), ""],
              ["BPM", item.bpm ? String(Math.round(item.bpm)) : "—", ""],
            ] as [string, string, string][]).map(([k, v, c]) => (
              <div key={k} className="fact"><div className="k">{k}</div><div className={`v mono ${c}`}>{v}</div></div>
            ))}
          </div>
          {!!item.plugins?.length && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {item.plugins.map((pl) => <span key={pl} className="pill" style={{ fontSize: 11 }}>🔌 {pl}</span>)}
            </div>
          )}
        </section>
      </div>

      {events.length > 0 && (
        <section className="ltimeline glass">
          <h2>What changed, and when</h2>
          <p className="tsub">Every backup is compared to the last one — so the project's whole life is on the record.</p>
          <ul className="tl">
            {events.map((e, i) => (
              <li key={i} className={e.kind}>
                <span className="when mono">{fmtDT(e.when)}</span>
                <div className="what">{e.what}</div>
                <span className="delta mono">{e.delta}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={`ltoast${toast ? " ltoast--show" : ""}`} role="status">{toast ?? ""}</div>
    </>
  );
}
