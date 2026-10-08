import { useEffect, useMemo, useState } from "react";
import { openMenu, CopyButton, toast, toastWarn } from "../components/Desktop";
import { plainReason } from "../runBackup";
import { makeApi } from "../api";
import type { Snapshot, VerifyResult, SnapshotFile, SnapshotFilesResult, SnapshotDiff } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { fmtSize, fmtDate, shortPath, sourceLabel, fmtCount } from "../format";
import { runRelinkBackup, pointSampleToFile } from "../relink";
import "../missing.css";
import { osWords } from "../platform";

const api = makeApi();
function reveal(p?: string) { if (p) (window as any).ablebackup?.revealPath?.(p); }
function openInDaw(p?: string) { if (p) (window as any).ablebackup?.openProject?.(p); }
const PROJECT_EXT = /\.(als|flp|rpp|dawproject|aup3|aup|song|bwproject)$/i;
// A Logic project is a folder (package) at the top of the backup: "Song.logicx/…".
const PACKAGE_TOP = /^([^/]+\.(logicx|logic))\//i;

function FileGroup({ label, files, snapDir, open, toggle, showSource }: {
  label: string; files: SnapshotFile[]; snapDir?: string;
  open: boolean; toggle: () => void; showSource?: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <button className="filegroup__head" onClick={toggle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={open ? "chevronDown" : "chevronRight"} size={14} />{label}</span>
        <span className="sub mono" style={{ margin: 0 }}>{files.length}</span>
      </button>
      {open && files.map((f) => {
        const name = f.logical_path.split("/").pop();
        return (
          <div key={f.logical_path} className="filerow" title={snapDir ? "Reveal in the backup" : undefined}
            onClick={() => reveal(snapDir ? `${snapDir}/${f.logical_path}` : undefined)}>
            <span className="filerow__name">{name}</span>
            {f.relinked && <span className="tag filerow__tag">found for you</span>}
            {showSource && <span className="filerow__src">from {sourceLabel(f.source_path)}</span>}
            <span className="filerow__size mono">{fmtSize(f.size)}</span>
          </div>
        );
      })}
    </div>
  );
}

// A project's backups: snapshot timeline + the selected snapshot's detail (verify /
// restore / share / open / file browser / diff). This IS the "backups" surface —
// it renders wherever a project's details are shown, never as its own destination.
export function ProjectBackups({ projectName, projectPath, onFixed }: {
  projectName: string; projectPath?: string; onFixed?: () => void;
}) {
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
  const [fixing, setFixing] = useState<string | null>(null);   // expected_path being fixed, or "folder"/"all"
  const [fixMsg, setFixMsg] = useState<{ ok?: string; err?: string } | null>(null);

  function loadSnaps(selectNewest = false) {
    api.projectDetail(projectName).then((d) => {
      setSnaps(d.snapshots);
      if (selectNewest) {
        const newest = d.snapshots[d.snapshots.length - 1];
        if (newest) setSelId(newest.id);
      }
    }).catch(() => {});
  }
  useEffect(() => {
    setSnaps([]); setSelId(null); setFiles(null); setFixMsg(null);
    api.projectDetail(projectName).then((d) => {
      setSnaps(d.snapshots);
      const newest = d.snapshots[d.snapshots.length - 1];
      if (newest) setSelId(newest.id);
    }).catch(() => {});
  }, [projectName]);

  // Fix missing samples right from the backup view — relink and make a fresh,
  // verified backup. `tag` is the expected_path of one sample, or "folder"/"all".
  async function fix(tag: string, run: () => Promise<void>) {
    if (!projectPath) return;
    setFixing(tag); setFixMsg(null);
    try {
      await run();
      setFixMsg({ ok: "Relinked and backed up. A fresh checked backup now holds it." });
      loadSnaps(true);
      onFixed?.();
    } catch (e: any) {
      if (e?.message === "__cancelled__") { setFixing(null); return; }  // user closed the picker
      setFixMsg({ err: e.message || "Couldn't fix it — check a backup destination is set in Settings." });
    } finally {
      setFixing(null);
    }
  }
  const pointToFile = (expected: string) => fix(expected, async () => {
    const picked = await pointSampleToFile(projectPath!, expected);
    if (!picked) throw new Error("__cancelled__");
  });
  const lookInFolder = () => fix("folder", async () => {
    const dir = await (window as any).ablebackup?.pickFolder?.();
    if (!dir) throw new Error("__cancelled__");
    await runRelinkBackup(projectPath!, { libraries: [dir] });
  });
  useEffect(() => {
    if (selId == null) { setFiles(null); setDiff(null); return; }
    setLoadingFiles(true); setShowDiff(false);
    api.snapshotFiles(selId).then(setFiles).catch(() => setFiles(null)).finally(() => setLoadingFiles(false));
    api.snapshotDiff(selId).then(setDiff).catch(() => setDiff(null));
  }, [selId]);

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
    } catch (e: any) {
      // say so: otherwise the button just stops spinning and nothing seems to happen
      toastWarn(`Couldn't check this backup. ${plainReason(e?.message)}`, { label: "Try again", onClick: () => { verify(id); } });
    }
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

  if (snaps.length === 0) {
    return <p className="sub" style={{ margin: 0, fontSize: 12 }}>No backups of this project yet.</p>;
  }
  return (
    <>
      <div className="table snap-cols" style={{ marginBottom: 22 }}>
        <div className="row cols cols-head"><span /><span>Backup</span><span className="col-num">Files</span><span className="col-num">Size</span><span>Checked</span></div>
        {[...snaps].reverse().map((s) => (
          <button key={s.id} onClick={() => setSelId(s.id)} aria-pressed={selId === s.id}
            onContextMenu={(e) => { setSelId(s.id); openMenu(e, [
              { label: verifying.has(s.id) ? "Checking…" : "Check again", onClick: () => { verify(s.id); }, disabled: verifying.has(s.id) },
              { label: restoring.has(s.id) ? "Restoring…" : "Restore…", onClick: () => { restore(s.id); }, disabled: restoring.has(s.id) },
              { label: sharing.has(s.id) ? "Zipping…" : "Share as a zip", onClick: () => { share(s.id); }, disabled: sharing.has(s.id) },
            ]); }}
            className={`row cols snaprow${selId === s.id ? " row--selected" : ""}`}>
            <span className={`dot${s.verified ? " dot--ok" : ""}`} />
            <span className="col-trunc" title={s.label ? `${fmtDate(s.timestamp)} · ${s.label}` : undefined}>{fmtDate(s.timestamp)}{s.label ? ` · ${s.label}` : ""}</span>
            <span className="col-num">{fmtCount(s.file_count)}</span>
            <span className="col-num">{fmtSize(s.total_size)}</span>
            <span className={s.verified ? "" : "faint"}>{s.verified ? "Opens, files match" : "Not checked"}</span>
          </button>
        ))}
      </div>

      {sel && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0 }}>{fmtDate(sel.timestamp)}{sel.label ? ` · ${sel.label}` : ""}</h2>
              <div className="sub" style={{ margin: "5px 0 0", fontSize: 12 }}>
                {fmtCount(sel.file_count)} file{sel.file_count === 1 ? "" : "s"} · {fmtSize(sel.total_size)}
                {groups.gathered.length > 0 && (
                  <> · {groups.gathered.length} gathered from {locations} location{locations === 1 ? "" : "s"}</>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 7, alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {files?.portable && <span className="tag" title="Every sample is inside the backup, so it opens on any computer">Self-contained</span>}
              <Button size="sm" variant="ghost" onClick={() => verify(sel.id)} disabled={verifying.has(sel.id)}>{verifying.has(sel.id) ? "Checking…" : "Check again"}</Button>
              <Button size="sm" variant="ghost" onClick={() => restore(sel.id)} disabled={restoring.has(sel.id)}>{restoring.has(sel.id) ? "Restoring…" : "Restore"}</Button>
              <Button size="sm" variant="ghost" onClick={() => share(sel.id)} disabled={sharing.has(sel.id)}>{sharing.has(sel.id) ? "Zipping…" : "Share"}</Button>
              {(() => {
                // the snapshot's own project file (root-level, project extension)
                const proj = files?.files.find((f) => !f.logical_path.includes("/") && PROJECT_EXT.test(f.logical_path));
                const pkg = proj ? null : files?.files.map((f) => PACKAGE_TOP.exec(f.logical_path)?.[1]).find(Boolean);
                const target = proj?.logical_path ?? pkg;
                return sel.dir && target
                  ? <Button size="sm" variant="ghost" onClick={() => openInDaw(`${sel.dir}/${target}`)}
                      title="Open this backed-up version in its DAW">Open this version</Button>
                  : null;
              })()}
              {sel.dir && <button className="iconbtn" title="Show in folder" aria-label="Show this backup in its folder" onClick={() => reveal(sel.dir)}><Icon name="folder" /></button>}
            </div>
          </div>

          {rest && (
            <div className="note-box">
              {rest.error ? <span style={{ color: "var(--danger)" }}>Restore failed: {rest.error}</span>
                : rest.note ? <span style={{ color: "var(--text-dim)" }}>{rest.note}</span>
                : <span><span style={{ color: "var(--accent-2)", fontWeight: 500 }}>Restored</span> to {shortPath(rest.path || "", 4)}
                  {rest.path && <Button variant="ghost" size="sm" style={{ marginLeft: 10 }} onClick={() => reveal(rest.path)}>Reveal</Button>}</span>}
            </div>
          )}
          {shr && (
            <div className="note-box">
              {shr.error ? <span style={{ color: "var(--danger)" }}>Share failed: {shr.error}</span>
                : shr.note ? <span style={{ color: "var(--text-dim)" }}>{shr.note}</span>
                : <span><span style={{ color: "var(--accent-2)", fontWeight: 500 }}>Zipped</span> to {shortPath(shr.path || "", 4)}, ready to send.
                  {shr.path && <Button variant="ghost" size="sm" style={{ marginLeft: 10 }} onClick={() => reveal(shr.path)}>Reveal</Button>}</span>}
            </div>
          )}
          {r && !r.error && (
            <div className="note-box" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Icon name={r.ok ? "check" : "alert"} size={18} className={r.ok ? "ok-text" : "warn-text"} />
              <div style={{ fontSize: 12 }}>
                <div style={{ color: r.ok ? "var(--accent-2)" : "var(--danger)", fontWeight: 500 }}>
                  {r.ok ? "Checked: every file is there and matches" : "Problems found"}
                </div>
                <div className="sub" style={{ margin: 0 }}>
                  {r.present}/{r.checked} files present, contents match
                  {r.bad_files.length > 0 ? ` · ${r.bad_files.length} corrupted` : ""}
                </div>
              </div>
            </div>
          )}

          {diff && diff.available && (
            <div className="note-box">
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: diff.is_first ? 0 : 7 }}>
                {diff.is_first ? "First backup of this project" : `Changes since ${fmtDate(diff.prev_timestamp || "")}`}
              </div>
              {!diff.is_first && (
                diff.added.length + diff.changed.length + diff.removed.length === 0 ? (
                  <div className="sub" style={{ margin: 0, fontSize: 12 }}>Nothing changed since the backup before.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--accent-2)" }}>{diff.added.length} added</span>
                      <span style={{ color: "var(--warn)" }}>{diff.changed.length} changed</span>
                      <span style={{ color: "var(--danger)" }}>{diff.removed.length} removed</span>
                      <span className="sub" style={{ margin: 0 }}>{diff.unchanged} unchanged</span>
                    </div>
                    <button className="linkbtn" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setShowDiff((s) => !s)}>
                      {showDiff ? "hide" : "show"} which files
                    </button>
                    {showDiff && (
                      <ul style={{ margin: "7px 0 0", paddingLeft: 16, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.7 }}>
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
            <p className="sub">File details weren't recorded for this older backup — use Reveal to open it in {osWords().fileManager}.</p>
          )}
          {!loadingFiles && files?.manifest_present && (
            <div className="filebrowser">
              <FileGroup label="Project" files={groups.project} snapDir={sel.dir}
                open={open.project} toggle={() => setOpen((g) => ({ ...g, project: !g.project }))} />
              <FileGroup label="Gathered samples" files={groups.gathered} snapDir={sel.dir} showSource
                open={open.gathered} toggle={() => setOpen((g) => ({ ...g, gathered: !g.gathered }))} />
              <FileGroup label="In-project samples" files={groups.internal} snapDir={sel.dir}
                open={open.internal} toggle={() => setOpen((g) => ({ ...g, internal: !g.internal }))} />
            </div>
          )}

          {sel.missing && sel.missing.length > 0 && (
            <div className="miss" style={{ marginTop: 20 }}>
              <div className="miss-head">
                <div>
                  <div className="miss-title">{sel.missing.length} sample{sel.missing.length === 1 ? "" : "s"} couldn’t be found</div>
                  <div className="miss-sum">
                    These were missing when this backup ran. Point each one at the right file, or
                    search a folder. It relinks them and makes a fresh checked backup.
                  </div>
                </div>
                {projectPath && (
                  <div className="miss-actions">
                    <Button size="sm" variant="ghost" onClick={lookInFolder} disabled={fixing !== null}>
                      {fixing === "folder" ? "Searching…" : "Look in a folder…"}
                    </Button>
                  </div>
                )}
              </div>
              {fixMsg && <div className={`miss-note ${fixMsg.err ? "err" : "ok"}`}>{fixMsg.err || fixMsg.ok}</div>}
              <div className="table miss-list" style={{ marginTop: 12 }}>
                {sel.missing.map((m) => (
                  <div key={m} className="row cols miss-cols miss-cols--short">
                    <div className="miss-file">
                      <div className="miss-name" title={m}>{m.split("/").pop()}</div>
                      <div className="pathline">
                        <div className="miss-path mono" title={m}>{m}</div>
                        <CopyButton text={m} what="where it should be" size={13} />
                      </div>
                    </div>
                    {projectPath
                      ? <Button size="sm" variant="ghost" onClick={() => pointToFile(m)} disabled={fixing !== null}
                          title="Pick the exact replacement file for this sample">
                          {fixing === m ? "Linking…" : "Point to file"}
                        </Button>
                      : <span className="miss-badge lost">Missing</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
