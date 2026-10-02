import { useEffect, useRef, useState } from "react";
import { makeApi } from "../api";
import type { ExportRow, LibraryItem, ProjectExports as Data } from "../types";
import { Button } from "../components/Button";
import { PlayButton } from "../components/Player";
import { fmtSize } from "../format";

const api = makeApi();
const bridge = () => (window as any).ablebackup;

const fmtWhen = (secs: number | null) =>
  secs ? new Date(secs * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

// Plain words for how the song was linked to this project.
const HOW: Record<ExportRow["match"], string> = {
  folder: "saved in the project folder",
  name: "name matches this project",
  manual: "added by you",
};

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

// "Songs from this project": every export (bounce/render) linked to the project,
// newest first, with a play button, its SoundCloud link when Uploader has posted it,
// and the controls to fix a wrong or missed match.
export function ProjectExports({ item, onChanged }: { item: LibraryItem; onChanged?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [folders, setFolders] = useState<{ folders: string[]; found_folders?: string[]; ignored?: string[]; uploader_folders: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // While Backups is still looking through folders for songs: "folder 3 of 12".
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);

  function load() {
    api.projectExports(item.project_id).then(setData).catch((e) => setErr(String(e.message ?? e)));
    api.exportFolders().then(setFolders).catch(() => {});
    api.exportsStatus().then((st) => { if (st.running) follow(); }).catch(() => {});
  }
  useEffect(load, [item.project_id]);

  // Poll the re-check until it ends, then show what it found.
  const following = useRef(false);
  function follow() {
    if (following.current) return;
    following.current = true;
    const tick = () => api.exportsStatus().then((st) => {
      if (st.running) {
        setChecking({ done: st.folders_done, total: st.folders_total });
        setTimeout(tick, 1200);
      } else {
        following.current = false;
        setChecking(null);
        api.projectExports(item.project_id).then(setData).catch(() => {});
        api.exportFolders().then(setFolders).catch(() => {});
        onChanged?.();
      }
    }).catch(() => { following.current = false; setChecking(null); });
    tick();
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try {
      const r: any = await fn();
      if (r && r.running) follow();
      load(); onChanged?.();
    }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  async function addSong() {
    const p: string | null = await bridge()?.pickFile?.();
    if (p) run(() => api.linkExport(p, item.project_id));
  }
  async function addFolder() {
    const p: string | null = await bridge()?.pickFolder?.();
    if (p) run(() => api.setExportFolders([...(folders?.folders ?? []), p]));
  }
  function removeFolder(p: string) {
    run(() => api.setExportFolders((folders?.folders ?? []).filter((f) => f !== p)));
  }
  // A folder Backups found by itself: remember not to look there again.
  function ignoreFound(p: string) {
    run(() => api.setExportFolders(folders?.folders ?? [], [...(folders?.ignored ?? []), p]));
  }

  const rows = data?.exports ?? [];
  const lookIn = [...(folders?.folders ?? []), ...(folders?.found_folders ?? []), ...(folders?.uploader_folders ?? [])];

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="sub" style={{ margin: "0 0 10px", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Songs from this project
      </div>

      {err && <div className="sub" style={{ color: "var(--danger)", margin: "0 0 8px" }}>{err}</div>}

      {checking && (
        <div className="sub" role="status" style={{ margin: "0 0 10px" }}>
          Checking your folders for songs{checking.total > 0 ? ` (${Math.min(checking.done + 1, checking.total)} of ${checking.total})` : ""}…
        </div>
      )}

      {data && rows.length === 0 && !checking && (
        <div className="sub" style={{ margin: "0 0 10px" }}>
          No exported songs found for this project yet.
          {lookIn.length === 0 && " Tell Backups where you save your exports and it will find them."}
        </div>
      )}

      {(rows.length > 0 || (data?.uploads_elsewhere ?? []).length > 0) && (
        <div className="cols cols-head song-cols" aria-hidden>
          <span /><span>Song</span><span className="col-num">Exported</span><span className="col-num">Size</span><span /><span />
        </div>
      )}
      {rows.map((e) => (
        <div key={e.path} className="row cols song-cols">
          {e.exists ? <PlayButton path={e.path} title={e.name} /> : <span />}
          <div>
            <div className="col-trunc" title={e.path}>{e.name}</div>
            <div className="sub col-trunc" style={{ margin: 0, fontSize: 11.5 }}>
              {e.exists ? HOW[e.match] : "File has been moved or deleted"}
            </div>
          </div>
          <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>{e.exists ? fmtWhen(e.mtime) : "—"}</div>
          <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>{e.exists ? fmtSize(e.size ?? 0) : "—"}</div>
          <div className="col-end">
            {e.upload?.url && (
              <button type="button" className="pill pill--ok" style={{ border: 0, cursor: "pointer" }}
                title={`Uploaded as "${e.upload.title}"`} onClick={() => bridge()?.openExternal?.(e.upload!.url)}>
                On SoundCloud ↗
              </button>
            )}
          </div>
          <div className="song-actions">
            <Button variant="ghost" size="sm" onClick={() => bridge()?.revealPath?.(e.path)}
              style={{ visibility: e.exists ? "visible" : "hidden" }}>Show file</Button>
            <Button variant="ghost" size="sm" disabled={busy}
              title="Remove this song from the project. It won't be matched again."
              onClick={() => run(() => api.unlinkExport(e.path, item.project_id))}>
              Not from this project
            </Button>
          </div>
        </div>
      ))}

      {(data?.uploads_elsewhere ?? []).map((u) => (
        <div key={u.url ?? u.title} className="row cols song-cols">
          <span />
          <div>
            <div className="col-trunc">{u.title}</div>
            <div className="sub col-trunc" style={{ margin: 0, fontSize: 11.5 }}>On SoundCloud · the file has since moved</div>
          </div>
          <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>—</div>
          <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>—</div>
          <div className="col-end">
            {u.url && (
              <button type="button" className="pill pill--ok" style={{ border: 0, cursor: "pointer" }}
                onClick={() => bridge()?.openExternal?.(u.url)}>On SoundCloud ↗</button>
            )}
          </div>
          <div className="song-actions" />
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={addSong}>Add a song…</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={addFolder}>Add an exports folder…</Button>
        <Button variant="ghost" size="sm" disabled={busy || !!checking} onClick={() => run(() => api.refreshExports())}
          title="Look through the folders again for songs saved since">Look again</Button>
      </div>

      {folders && (
        <div className="sub" style={{ margin: "10px 0 0", fontSize: 11.5 }}>
          Looking in: the project folder
          {folders.folders.map((f) => (
            <span key={f}>
              {", "}<span title={f}>{folderName(f)}</span>
              <button type="button" aria-label={`Stop looking in ${folderName(f)}`} title="Stop looking here"
                onClick={() => removeFolder(f)} disabled={busy}
                style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: "0 2px" }}>×</button>
            </span>
          ))}
          {(folders.found_folders ?? []).map((f) => (
            <span key={`f-${f}`}>
              {", "}<span title={`${f} (found automatically)`}>{folderName(f)}</span>
              <button type="button" aria-label={`Stop looking in ${folderName(f)}`} title="Stop looking here"
                onClick={() => ignoreFound(f)} disabled={busy}
                style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: "0 2px" }}>×</button>
            </span>
          ))}
          {folders.uploader_folders.map((f) => (
            <span key={`u-${f}`} title={`${f} (from Uploader)`}>{", "}{folderName(f)} (Uploader)</span>
          ))}
        </div>
      )}
    </div>
  );
}
