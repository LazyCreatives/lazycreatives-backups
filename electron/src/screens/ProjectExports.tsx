import { useEffect, useState } from "react";
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
  const [folders, setFolders] = useState<{ folders: string[]; uploader_folders: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.projectExports(item.project_id).then(setData).catch((e) => setErr(String(e.message ?? e)));
    api.exportFolders().then(setFolders).catch(() => {});
  }
  useEffect(load, [item.project_id]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); load(); onChanged?.(); }
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

  const rows = data?.exports ?? [];
  const lookIn = [...(folders?.folders ?? []), ...(folders?.uploader_folders ?? [])];

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="sub" style={{ margin: "0 0 10px", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Songs from this project
      </div>

      {err && <div className="sub" style={{ color: "var(--danger)", margin: "0 0 8px" }}>{err}</div>}

      {data && rows.length === 0 && (
        <div className="sub" style={{ margin: "0 0 10px" }}>
          No exported songs found for this project yet.
          {lookIn.length === 0 && " Tell Backups where you save your exports and it will find them."}
        </div>
      )}

      {rows.map((e) => (
        <div key={e.path} className="row" style={{ gap: 10 }}>
          {e.exists ? <PlayButton path={e.path} title={e.name} /> : <span style={{ width: 30 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.path}>{e.name}</div>
            <div className="sub" style={{ margin: 0, fontSize: 11.5 }}>
              {e.exists ? `${fmtWhen(e.mtime)} · ${fmtSize(e.size ?? 0)} · ${HOW[e.match]}` : "File has been moved or deleted"}
            </div>
          </div>
          {e.upload?.url && (
            <button type="button" className="pill pill--ok" style={{ border: 0, cursor: "pointer" }}
              title={`Uploaded as "${e.upload.title}"`} onClick={() => bridge()?.openExternal?.(e.upload!.url)}>
              On SoundCloud ↗
            </button>
          )}
          {e.exists && (
            <Button variant="ghost" size="sm" onClick={() => bridge()?.revealPath?.(e.path)}>Show file</Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy}
            title="Remove this song from the project. It won't be matched again."
            onClick={() => run(() => api.unlinkExport(e.path, item.project_id))}>
            Not from this project
          </Button>
        </div>
      ))}

      {(data?.uploads_elsewhere ?? []).map((u) => (
        <div key={u.url ?? u.title} className="row" style={{ gap: 10 }}>
          <span style={{ width: 30 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{u.title}</div>
            <div className="sub" style={{ margin: 0, fontSize: 11.5 }}>On SoundCloud · the file has since moved</div>
          </div>
          {u.url && (
            <button type="button" className="pill pill--ok" style={{ border: 0, cursor: "pointer" }}
              onClick={() => bridge()?.openExternal?.(u.url)}>On SoundCloud ↗</button>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={addSong}>Add a song…</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={addFolder}>Add an exports folder…</Button>
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
          {folders.uploader_folders.map((f) => (
            <span key={`u-${f}`} title={`${f} (from Uploader)`}>{", "}{folderName(f)} (Uploader)</span>
          ))}
        </div>
      )}
    </div>
  );
}
