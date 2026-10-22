import { useEffect, useRef, useState } from "react";
import { makeApi, type NasInfo } from "../api";
import { useDialogFocus } from "./a11y";
import { Button } from "./Button";
import { Icon } from "./Icon";

const api = makeApi();

/** "Add a folder on the NAS" (Settings, Project folders): the NAS's shared folders,
 *  with the login saved by Find my NAS. Pick one and Backups connects it, then the
 *  folder picker opens inside it so you choose where your projects are. Backups only
 *  reads them, and connects the shared folder again by itself when the NAS wakes. */
export function NasFolders({ nas, onPicked, onClose }: {
  nas: NasInfo; onPicked: (dir: string, label: string) => void; onClose: () => void;
}) {
  const [shares, setShares] = useState<string[] | null>(null);
  const [listed, setListed] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);

  useEffect(() => {
    api.nasMyShares().then((r) => { setShares(r.shares); setListed(r.listed); })
      .catch((e: any) => { setShares([]); setListed(false); setErr(e.message || null); });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function use(share: string) {
    setBusy(share); setErr(null);
    try {
      const { path } = await api.nasOpenShare(share);
      const dir: string | null = await (window as any).ablebackup?.pickFolder?.(path);
      setBusy(null);
      if (dir) {
        // "TNAS › Projects › 2024": what people see on the NAS, not where it's connected
        const inside = dir.startsWith(path) ? dir.slice(path.length).split(/[\\/]+/).filter(Boolean) : [];
        onPicked(dir, [nas.name, share, ...inside].join(" › "));
      }
    } catch (e: any) { setErr(e.message || `Couldn't connect ${share}.`); setBusy(null); }
  }

  return (
    <div className="modal__scrim nasp__scrim" onClick={() => { if (!busy) onClose(); }}>
      <div ref={ref} className="modal nasp" role="dialog" aria-modal="true" aria-labelledby="nasf-title" onClick={(e) => e.stopPropagation()}>
        <div className="nasp__head">
          <div className="nasp__titles">
            <h2 id="nasf-title">Projects on your NAS</h2>
            <span className="nasp__sub col-trunc" title={nas.name}><bdi>{nas.name}</bdi></span>
          </div>
          <button type="button" className="nasp__x" aria-label="Close" onClick={onClose} disabled={!!busy}><Icon name="close" size={16} /></button>
        </div>
        <p className="sub nasp__say">Pick the shared folder your projects are in, then the folder inside it. Backups only reads them, and opens them in your music app straight from the NAS.</p>
        {shares === null ? (
          <p className="nasp__wait" role="status"><span className="nasp__dot" aria-hidden />Asking the NAS…</p>
        ) : !listed || shares.length === 0 ? (
          <p className="nasp__none">{err ? "" : listed ? "This login can't see any shared folders. " : "The NAS didn't list its shared folders. "}Type the name of the one your projects are in.</p>
        ) : (
          <div className="table nasf-cols">
            <div className="row cols cols-head" aria-hidden><span /><span>Shared folder</span><span /></div>
            <div role="list" className="nasp__rows">
              {shares.map((s) => (
                <div key={s} className="row cols" role="listitem">
                  <Icon name="folder" size={15} className="faint" />
                  <span className="col-trunc nasp__name" title={s}><bdi>{s}</bdi></span>
                  <span className="col-act">
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => use(s)} aria-label={`Pick a folder in ${s}`}>
                      {busy === s ? "Connecting…" : "Open"}
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <form className="nasp__typed" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) use(typed.trim().replace(/^[\\/]+|[\\/]+$/g, "")); }}>
          <label className="field">
            <span>{listed && shares?.length ? "Not listed? Type its name" : "Shared folder's name"}</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Projects" spellCheck={false} />
          </label>
          <div className="set-inline">
            <Button size="sm" type="submit" disabled={!typed.trim() || !!busy}>{busy && busy === typed.trim() ? "Connecting…" : "Open"}</Button>
          </div>
        </form>
        {err && <p className="set-note set-note--bad" role="alert">{err}</p>}
      </div>
    </div>
  );
}
