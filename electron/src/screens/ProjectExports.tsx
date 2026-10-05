import { useEffect, useRef, useState } from "react";
import { openMenu, toast } from "../components/Desktop";
import { baseName, copyText } from "../desktop";
import { makeApi } from "../api";
import type { ExportRow, LibraryItem, ProjectExports as Data } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { PlayButton, SongWave } from "../components/Player";
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
  const songMeta = (title: string) => ({ title, project: item.name, genre: item.genre });
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
    const before = folders?.folders ?? [];
    run(() => api.setExportFolders(before.filter((f) => f !== p)));
    toast(`Stopped looking for songs in ${baseName(p)}.`, { label: "Undo", onClick: () => run(() => api.setExportFolders(before)) });
  }
  // "Not from this project": drop the song here, with a way back.
  function unlink(path: string, name: string) {
    run(() => api.unlinkExport(path, item.project_id));
    toast(`Removed ${name} from this project.`, { label: "Undo", onClick: () => run(() => api.linkExport(path, item.project_id)) });
  }
  // A folder Backups found by itself: remember not to look there again.
  function ignoreFound(p: string) {
    run(() => api.setExportFolders(folders?.folders ?? [], [...(folders?.ignored ?? []), p]));
  }

  const rows = data?.exports ?? [];
  // The SoundCloud column only takes room when a song is actually on SoundCloud.
  const linked = rows.some((e) => e.upload?.url) || (data?.uploads_elsewhere ?? []).some((u) => u.url);
  const cols = `row cols song-cols${linked ? "" : " song-cols--nolink"}`;
  const lookIn = [...(folders?.folders ?? []), ...(folders?.found_folders ?? []), ...(folders?.uploader_folders ?? [])];

  return (
    <div>

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
        <div className="table">
        <div className={`${cols} cols-head`} aria-hidden>
          <span /><span>Song</span><span className="col-num">Exported</span><span className="col-num">Size</span>{linked && <span>SoundCloud</span>}<span />
        </div>
      {rows.map((e) => (
        <div key={e.path} className={cols} onContextMenu={(ev) => openMenu(ev, [
          ...(e.upload?.url ? [
            { label: "Open on SoundCloud", onClick: () => bridge()?.openExternal?.(e.upload!.url) },
            { label: "Copy SoundCloud link", onClick: () => { copyText(e.upload!.url!); } }, "-" as const] : []),
          ...(e.exists ? [{ label: "Show the file", onClick: () => bridge()?.revealPath?.(e.path) }] : []),
          { label: "Copy file path", onClick: () => { copyText(e.path); } },
        ])}>
          {e.exists ? <PlayButton path={e.path} title={e.name} meta={songMeta(e.name)} /> : <span />}
          <div style={{ minWidth: 0 }}>
            <div className="song-name" title={`${e.path}\n${HOW[e.match]}`}>{e.name}</div>
            {e.exists
              ? <SongWave path={e.path} meta={songMeta(e.name)} height={20} />
              : <div className="sub col-trunc" style={{ margin: 0, fontSize: 11.5 }}>File has been moved or deleted</div>}
          </div>
          <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>{e.exists ? fmtWhen(e.mtime) : "—"}</div>
          <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>{e.exists ? fmtSize(e.size ?? 0) : "—"}</div>
          {linked && <div className="col-end">
            {e.upload?.url && (
              <button type="button" className="pill pill--ok linkpill"
                title={`Uploaded as "${e.upload.title}"`} onClick={() => bridge()?.openExternal?.(e.upload!.url)}>
                On SoundCloud <Icon name="external" size={12} />
              </button>
            )}
          </div>}
          <div className="song-actions">
            <button className="iconbtn" title="Show the file" aria-label={`Show ${e.name}`}
              onClick={() => bridge()?.revealPath?.(e.path)} style={{ visibility: e.exists ? "visible" : "hidden" }}><Icon name="folder" /></button>
            <button className="iconbtn" disabled={busy}
              title="Not from this project: remove it here and don't match it again"
              aria-label={`${e.name} is not from this project`}
              onClick={() => unlink(e.path, e.name)}><Icon name="close" /></button>
          </div>
        </div>
      ))}

      {(data?.uploads_elsewhere ?? []).map((u) => (
        <div key={u.url ?? u.title} className={cols}>
          <span />
          <div>
            <div className="song-name">{u.title}</div>
            <div className="sub col-trunc" style={{ margin: 0, fontSize: 11.5 }}>On SoundCloud · the file has since moved</div>
          </div>
          <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>—</div>
          <div className="sub col-num" style={{ margin: 0, fontSize: 12 }}>—</div>
          {linked && <div className="col-end">
            {u.url && (
              <button type="button" className="pill pill--ok linkpill"
                onClick={() => bridge()?.openExternal?.(u.url)}>On SoundCloud <Icon name="external" size={12} /></button>
            )}
          </div>}
          <div className="song-actions" />
        </div>
      ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={addSong}>Add a song…</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={addFolder}>Add an exports folder…</Button>
        <Button variant="ghost" size="sm" disabled={busy || !!checking} onClick={() => run(() => api.refreshExports())}
          title="Look through the folders again for songs saved since">Look again</Button>
      </div>

      {folders && (
        <div className="faint" style={{ margin: "12px 0 0", fontSize: 12.5 }}>
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
