import { useEffect, useMemo, useState } from "react";
import { makeApi } from "../api";
import type { ProjectRow, Snapshot, VerifyResult, SnapshotFile, SnapshotFilesResult, SnapshotDiff } from "../types";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { VerifiedSeal } from "../components/VerifiedSeal";
import { fmtSize, fmtDate, shortPath, dawLabel, sourceLabel } from "../format";

const api = makeApi();
function reveal(p?: string) { if (p) (window as any).ablebackup?.revealPath?.(p); }

// A stable hue per genre so each crate + card has its own visual identity.
const GENRE_HUE: Record<string, number> = {
  "Boom bap": 28, "Hip hop": 16, "Lo-fi": 280, "Trap": 348, "Drill": 4, "Phonk": 300,
  "House": 200, "Tech house": 190, "Techno": 210, "Trance": 250, "UK garage": 150,
  "Grime": 120, "Dubstep": 95, "DnB": 40, "Jungle": 80, "Hardstyle": 0, "Hyperpop": 320,
  "Pop": 330, "Ambient": 230,
};
function genreHue(genre?: string | null): number {
  if (!genre) return 220;
  if (genre in GENRE_HUE) return GENRE_HUE[genre];
  let h = 0; for (const c of genre) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function FileGroup({ label, icon, files, snapDir, open, toggle, showSource }: {
  label: string; icon: string; files: SnapshotFile[]; snapDir?: string;
  open: boolean; toggle: () => void; showSource?: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <button className="filegroup__head" onClick={toggle}>
        <span>{open ? "▾" : "▸"} {icon} {label}</span>
        <span className="sub mono" style={{ margin: 0 }}>{files.length}</span>
      </button>
      {open && files.map((f) => {
        const name = f.logical_path.split("/").pop();
        return (
          <div key={f.logical_path} className="filerow" title={snapDir ? "Reveal in the backup" : undefined}
            onClick={() => reveal(snapDir ? `${snapDir}/${f.logical_path}` : undefined)}>
            <span className="filerow__name">{name}</span>
            {f.relinked && <span className="pill pill--ok filerow__tag">auto-found</span>}
            {showSource && <span className="filerow__src">← {sourceLabel(f.source_path)}</span>}
            <span className="filerow__size mono">{fmtSize(f.size)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Browse() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [mode, setMode] = useState<"crates" | "list">("crates");
  const [query, setQuery] = useState("");
  const [dawFilter, setDawFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"recent" | "name" | "size" | "snapshots">("recent");
  const [active, setActive] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [files, setFiles] = useState<SnapshotFilesResult | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ project: true, gathered: true, internal: false });
  const [results, setResults] = useState<Record<number, VerifyResult>>({});
  const [verifying, setVerifying] = useState<Set<number>>(new Set());
  const [restoring, setRestoring] = useState<Set<number>>(new Set());
  const [restored, setRestored] = useState<Record<number, { path?: string; error?: string; note?: string }>>({});
  const [sharing, setSharing] = useState<Set<number>>(new Set());
  const [shared, setShared] = useState<Record<number, { path?: string; error?: string; note?: string }>>({});

  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, []);
  // While genres are still being guessed in the background, re-poll so the crates
  // fill in live without a manual refresh.
  useEffect(() => {
    if (!projects.some((p) => p.genre_pending)) return;
    const t = setTimeout(() => api.projects().then(setProjects).catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, [projects]);
  useEffect(() => {
    setSnaps([]); setSelId(null); setFiles(null);
    if (active) api.projectDetail(active).then((d) => {
      setSnaps(d.snapshots);
      const newest = d.snapshots[d.snapshots.length - 1];
      if (newest) setSelId(newest.id);
    }).catch(() => {});
  }, [active]);
  useEffect(() => {
    if (selId == null) { setFiles(null); setDiff(null); return; }
    setLoadingFiles(true); setShowDiff(false);
    api.snapshotFiles(selId).then(setFiles).catch(() => setFiles(null)).finally(() => setLoadingFiles(false));
    api.snapshotDiff(selId).then(setDiff).catch(() => setDiff(null));
  }, [selId]);

  const daws = useMemo(() => Array.from(new Set(projects.map((p) => p.daw).filter(Boolean))) as string[], [projects]);
  const filtered = useMemo(() => {
    const f = projects.filter((p) =>
      (dawFilter === "all" || p.daw === dawFilter) &&
      p.project_name.toLowerCase().includes(query.toLowerCase()));
    const cmp = {
      recent: (a: ProjectRow, b: ProjectRow) => (b.last_timestamp || "").localeCompare(a.last_timestamp || ""),
      name: (a: ProjectRow, b: ProjectRow) => a.project_name.localeCompare(b.project_name),
      size: (a: ProjectRow, b: ProjectRow) => b.total_size - a.total_size,
      snapshots: (a: ProjectRow, b: ProjectRow) => b.snapshot_count - a.snapshot_count,
    }[sortKey];
    return [...f].sort(cmp);
  }, [projects, dawFilter, query, sortKey]);

  // Group the filtered projects into genre "crates", biggest crate first, with an
  // "Untagged" crate last for anything we couldn't confidently place.
  const crates = useMemo(() => {
    const by = new Map<string, ProjectRow[]>();
    for (const p of filtered) {
      const key = p.genre || (p.genre_pending ? "…" : "Untagged");
      (by.get(key) || by.set(key, []).get(key)!).push(p);
    }
    return [...by.entries()]
      .map(([genre, items]) => ({ genre, emoji: items[0]?.genre_emoji || "🎵", items }))
      .sort((a, b) => {
        const rank = (g: string) => (g === "Untagged" ? 2 : g === "…" ? 1 : 0);
        return rank(a.genre) - rank(b.genre) || b.items.length - a.items.length;
      });
  }, [filtered]);
  const tagging = projects.filter((p) => p.genre_pending).length;

  const sel = snaps.find((s) => s.id === selId) || null;

  const groups = useMemo(() => {
    const fs = files?.files ?? [];
    return {
      project: fs.filter((f) => f.inside_project && !f.logical_path.includes("/")),
      internal: fs.filter((f) => f.inside_project && f.logical_path.includes("/")),
      gathered: fs.filter((f) => !f.inside_project),
    };
  }, [files]);
  const locations = useMemo(
    () => new Set(groups.gathered.map((f) => sourceLabel(f.source_path))).size, [groups]);

  async function verify(id: number) {
    setVerifying((s) => new Set(s).add(id));
    try {
      const r = await api.verify(id);
      setResults((m) => ({ ...m, [id]: r }));
      setSnaps((list) => list.map((s) => s.id === id ? { ...s, verified: r.ok ? 1 : 0 } : s));
    } catch { /* surfaced as no result */ }
    finally { setVerifying((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }
  async function restore(id: number) {
    const target = await (window as any).ablebackup?.pickFolder?.();
    if (!target) return;
    setRestoring((s) => new Set(s).add(id));
    setRestored((m) => { const n = { ...m }; delete n[id]; return n; });
    try {
      const { job_id } = await api.restore(id, target);
      let res = await api.jobStatus(job_id);
      for (let i = 0; i < 2400 && res.state === "running"; i++) {
        await new Promise((r) => setTimeout(r, 500));
        res = await api.jobStatus(job_id);
      }
      setRestored((m) => ({ ...m, [id]:
        res.state === "done" ? { path: res.result?.path }
        : res.state === "error" ? { error: res.error || "restore failed" }
        : { note: "Still copying in the background — check the destination folder shortly." } }));
    } catch (e: any) {
      setRestored((m) => ({ ...m, [id]: { error: e.message } }));
    } finally {
      setRestoring((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function share(id: number) {
    const target = await (window as any).ablebackup?.pickFolder?.();
    if (!target) return;
    setSharing((s) => new Set(s).add(id));
    setShared((m) => { const n = { ...m }; delete n[id]; return n; });
    try {
      const { job_id } = await api.share(id, target);
      let res = await api.jobStatus(job_id);
      for (let i = 0; i < 2400 && res.state === "running"; i++) {
        await new Promise((r) => setTimeout(r, 500));
        res = await api.jobStatus(job_id);
      }
      setShared((m) => ({ ...m, [id]:
        res.state === "done" ? { path: res.result?.path }
        : res.state === "error" ? { error: res.error || "couldn't create the zip" }
        : { note: "Still zipping in the background — check the folder shortly." } }));
    } catch (e: any) {
      setShared((m) => ({ ...m, [id]: { error: e.message } }));
    } finally {
      setSharing((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  const r = selId != null ? results[selId] : undefined;
  const rest = selId != null ? restored[selId] : undefined;
  const shr = selId != null ? shared[selId] : undefined;

  return (
    <>
      <PageHeader title="History" subtitle="Every backup — and everything we gathered and tidied inside it." />

      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <div className="seg">
          <button className={`seg__opt${mode === "crates" ? " seg__opt--on" : ""}`} onClick={() => { setMode("crates"); setActive(null); }}>🎚 Crates</button>
          <button className={`seg__opt${mode === "list" ? " seg__opt--on" : ""}`} onClick={() => setMode("list")}>☰ List</button>
        </div>
        <input className="input" placeholder="Search projects…" value={query}
          onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, maxWidth: 240 }} />
        <select className="input" value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)} style={{ width: "auto" }}>
          <option value="recent">Recently backed up</option>
          <option value="name">Name (A–Z)</option>
          <option value="size">Size</option>
          <option value="snapshots">Most backups</option>
        </select>
        {daws.length > 1 && (
          <div className="seg">
            <button className={`seg__opt${dawFilter === "all" ? " seg__opt--on" : ""}`} onClick={() => setDawFilter("all")}>All</button>
            {daws.map((d) => (
              <button key={d} className={`seg__opt${dawFilter === d ? " seg__opt--on" : ""}`} onClick={() => setDawFilter(d)}>{dawLabel(d)}</button>
            ))}
          </div>
        )}
      </div>

      {mode === "crates" ? (
        <div style={{ maxHeight: "calc(100vh - 210px)", overflow: "auto", paddingRight: 4 }}>
          {tagging > 0 && (
            <div className="sub" style={{ margin: "0 0 12px" }}>
              🎧 Listening to your projects… tagging {tagging} more by genre.
            </div>
          )}
          {crates.length === 0 && <p className="sub">No projects yet — back one up and it'll land in a crate.</p>}
          {crates.map(({ genre, emoji, items }) => {
            const hue = genreHue(genre === "Untagged" || genre === "…" ? null : genre);
            return (
              <section key={genre} style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "0 0 10px" }}>
                  <span style={{ fontSize: 17 }}>{genre === "…" ? "🎧" : emoji}</span>
                  <h3 style={{ margin: 0, fontSize: 14, letterSpacing: 0.4, textTransform: "uppercase",
                    color: genre === "Untagged" || genre === "…" ? "var(--text-dim)" : `hsl(${hue} 70% 68%)` }}>
                    {genre === "…" ? "Tagging…" : genre}
                  </h3>
                  <span className="sub" style={{ margin: 0 }}>· {items.length}</span>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(178px, 1fr))", gap: 12 }}>
                  {items.map((p) => {
                    const h = genreHue(p.genre);
                    return (
                      <button key={p.project_name} onClick={() => { setActive(p.project_name); setMode("list"); }}
                        className="crate-card"
                        style={{
                          textAlign: "left", cursor: "pointer", padding: 0, overflow: "hidden",
                          borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)",
                        }}>
                        <div style={{ height: 54, background: p.genre
                          ? `linear-gradient(135deg, hsl(${h} 60% 22%), hsl(${h} 70% 38%))`
                          : "linear-gradient(135deg, #1a1c22, #2a2d36)",
                          display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 10px 6px" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,.92)" }}>
                            {p.bpm ? `${Math.round(p.bpm)} BPM` : ""}
                          </span>
                          <span style={{ fontSize: 16 }}>{p.genre_emoji || "🎵"}</span>
                        </div>
                        <div style={{ padding: "9px 11px 11px" }}>
                          <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.project_name}
                          </div>
                          <div className="sub" style={{ margin: "3px 0 0", fontSize: 11.5 }}>
                            {p.snapshot_count} backup{p.snapshot_count === 1 ? "" : "s"} · {fmtSize(p.total_size)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "calc(100vh - 230px)", overflow: "auto" }}>
          {filtered.length === 0 && <p className="sub">No projects.</p>}
          {filtered.map((p) => (
            <button key={p.project_name} onClick={() => setActive(p.project_name)} className="row"
              style={{
                width: "100%", textAlign: "left", cursor: "pointer",
                background: active === p.project_name ? "var(--surface-2)" : "var(--surface)",
                borderColor: active === p.project_name ? "var(--accent)" : "var(--border)",
              }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: "flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
                  <span className="daw-badge">{dawLabel(p.daw)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project_name}</span>
                </strong>
                <span className="sub" style={{ margin: 0 }}>
                  {p.genre && <span style={{ color: `hsl(${genreHue(p.genre)} 65% 66%)` }}>{p.genre_emoji} {p.genre}{p.bpm ? ` · ${Math.round(p.bpm)} BPM` : ""} · </span>}
                  {p.snapshot_count} backup{p.snapshot_count === 1 ? "" : "s"} · {fmtSize(p.total_size)}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div>
          {!active && <div className="empty"><div className="empty__icon">🗂️</div>Pick a project to explore its backups.</div>}
          {active && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {[...snaps].reverse().map((s) => (
                  <button key={s.id} onClick={() => setSelId(s.id)}
                    className={`snapchip${selId === s.id ? " snapchip--on" : ""}`}>
                    {fmtDate(s.timestamp)}{s.verified ? " ✓" : ""}
                  </button>
                ))}
              </div>

              {sel && (
                <div className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 15 }}>{fmtDate(sel.timestamp)}{sel.label ? ` · ${sel.label}` : ""}</strong>
                      <div className="sub" style={{ margin: "5px 0 0", fontSize: 12.5 }}>
                        {sel.file_count} file{sel.file_count === 1 ? "" : "s"} · {fmtSize(sel.total_size)}
                        {groups.gathered.length > 0 && (
                          <> · <span style={{ color: "var(--accent)" }}>{groups.gathered.length} gathered from {locations} location{locations === 1 ? "" : "s"}</span></>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 7, alignItems: "center", flexShrink: 0 }}>
                      {!!sel.verified && <span className="pill pill--ok">verified ✓</span>}
                      {files?.portable && <span className="pill">portable</span>}
                      <Button size="sm" variant="ghost" onClick={() => verify(sel.id)} disabled={verifying.has(sel.id)}>{verifying.has(sel.id) ? "Verifying…" : "Verify"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => restore(sel.id)} disabled={restoring.has(sel.id)}>{restoring.has(sel.id) ? "Restoring…" : "Restore"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => share(sel.id)} disabled={sharing.has(sel.id)}>{sharing.has(sel.id) ? "Zipping…" : "Share"}</Button>
                      {sel.dir && <Button size="sm" variant="ghost" onClick={() => reveal(sel.dir)}>Reveal</Button>}
                    </div>
                  </div>

                  {rest && (
                    <div className="card" style={{ marginBottom: 12, background: "var(--surface-2)", padding: 11, fontSize: 12.5 }}>
                      {rest.error ? <span style={{ color: "var(--danger)" }}>Restore failed: {rest.error}</span>
                        : rest.note ? <span style={{ color: "var(--text-dim)" }}>{rest.note}</span>
                        : <span><span style={{ color: "var(--accent-2)", fontWeight: 600 }}>✓ Restored</span> to {shortPath(rest.path || "", 4)}
                          {rest.path && <Button variant="ghost" size="sm" style={{ marginLeft: 10 }} onClick={() => reveal(rest.path)}>Reveal</Button>}</span>}
                    </div>
                  )}
                  {shr && (
                    <div className="card" style={{ marginBottom: 12, background: "var(--surface-2)", padding: 11, fontSize: 12.5 }}>
                      {shr.error ? <span style={{ color: "var(--danger)" }}>Share failed: {shr.error}</span>
                        : shr.note ? <span style={{ color: "var(--text-dim)" }}>{shr.note}</span>
                        : <span><span style={{ color: "var(--accent-2)", fontWeight: 600 }}>✓ Zipped</span> to {shortPath(shr.path || "", 4)} — ready to send.
                          {shr.path && <Button variant="ghost" size="sm" style={{ marginLeft: 10 }} onClick={() => reveal(shr.path)}>Reveal</Button>}</span>}
                    </div>
                  )}
                  {r && !r.error && (
                    <div className="card" style={{ marginBottom: 12, background: "var(--surface-2)", padding: 11, display: "flex", alignItems: "center", gap: 12 }}>
                      {r.ok ? <VerifiedSeal size={40} /> : <span style={{ fontSize: 22 }}>⚠</span>}
                      <div style={{ fontSize: 12.5 }}>
                        <div style={{ color: r.ok ? "var(--accent-2)" : "var(--danger)", fontWeight: 700 }}>
                          {r.ok ? "Verified" : "Problems found"}
                        </div>
                        <div className="sub" style={{ margin: 0 }}>
                          {r.present}/{r.checked} files present, contents match
                          {r.bad_files.length > 0 ? ` · ${r.bad_files.length} corrupted` : ""}
                        </div>
                      </div>
                    </div>
                  )}

                  {diff && diff.available && (
                    <div className="card" style={{ marginBottom: 12, background: "var(--surface-2)", padding: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: diff.is_first ? 0 : 7 }}>
                        {diff.is_first ? "First backup of this project" : `Changes since ${fmtDate(diff.prev_timestamp || "")}`}
                      </div>
                      {!diff.is_first && (
                        diff.added.length + diff.changed.length + diff.removed.length === 0 ? (
                          <div className="sub" style={{ margin: 0, fontSize: 12 }}>Identical to the previous backup — nothing changed.</div>
                        ) : (
                          <>
                            <div style={{ display: "flex", gap: 16, fontSize: 12.5, flexWrap: "wrap" }}>
                              <span style={{ color: "var(--accent-2)" }}>＋ {diff.added.length} added</span>
                              <span style={{ color: "var(--warn)" }}>✎ {diff.changed.length} changed</span>
                              <span style={{ color: "var(--danger)" }}>－ {diff.removed.length} removed</span>
                              <span className="sub" style={{ margin: 0 }}>{diff.unchanged} unchanged</span>
                            </div>
                            <button className="linkbtn" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setShowDiff((s) => !s)}>
                              {showDiff ? "hide" : "show"} which files
                            </button>
                            {showDiff && (
                              <ul style={{ margin: "7px 0 0", paddingLeft: 16, fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
                                {diff.added.map((p) => <li key={"a" + p}><span style={{ color: "var(--accent-2)" }}>＋</span> {p.split("/").pop()}</li>)}
                                {diff.changed.map((p) => <li key={"c" + p}><span style={{ color: "var(--warn)" }}>✎</span> {p.split("/").pop()}</li>)}
                                {diff.removed.map((p) => <li key={"r" + p}><span style={{ color: "var(--danger)" }}>－</span> {p.split("/").pop()}</li>)}
                              </ul>
                            )}
                          </>
                        )
                      )}
                    </div>
                  )}

                  {loadingFiles && <p className="sub">Reading the backup…</p>}
                  {!loadingFiles && files && !files.manifest_present && (
                    <p className="sub">File details weren't recorded for this older backup — use Reveal to open it in Finder.</p>
                  )}
                  {!loadingFiles && files?.manifest_present && (
                    <div className="filebrowser">
                      <FileGroup label="Project" icon="🎛️" files={groups.project} snapDir={sel.dir}
                        open={open.project} toggle={() => setOpen((g) => ({ ...g, project: !g.project }))} />
                      <FileGroup label="Gathered samples" icon="📥" files={groups.gathered} snapDir={sel.dir} showSource
                        open={open.gathered} toggle={() => setOpen((g) => ({ ...g, gathered: !g.gathered }))} />
                      <FileGroup label="In-project samples" icon="📁" files={groups.internal} snapDir={sel.dir}
                        open={open.internal} toggle={() => setOpen((g) => ({ ...g, internal: !g.internal }))} />
                    </div>
                  )}

                  {sel.missing && sel.missing.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="sub" style={{ color: "var(--warn)", fontSize: 12, marginBottom: 4 }}>⚠ {sel.missing.length} sample(s) couldn't be found at backup time:</div>
                      <ul style={{ color: "var(--warn)", margin: 0, paddingLeft: 18, fontSize: 12 }}>
                        {sel.missing.slice(0, 20).map((m) => <li key={m}>{m}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}
    </>
  );
}
