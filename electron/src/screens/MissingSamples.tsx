import { useCallback, useEffect, useState } from "react";
import { makeApi } from "../api";
import type { LibraryItem } from "../types";
import { Button } from "../components/Button";
import "../missing.css";

const api = makeApi();
const bridge = () => (window as any).ablebackup;

type Miss = { name: string; expected_path: string; recoverable: boolean };

// The trust view: the complete, live list of a project's missing samples. Each is
// shown with the exact path the project expects it at, and (once the library is
// checked) whether we can auto-find it or it needs the user to point at the file.
export function MissingSamples({ item, onChanged }: { item: LibraryItem; onChanged?: () => void }) {
  const [miss, setMiss] = useState<Miss[] | null>(null);
  const [present, setPresent] = useState(0);
  const [probed, setProbed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);     // "fix" | "folder" | an expected_path
  const [pointed, setPointed] = useState<Record<string, string>>({});  // expected_path -> chosen file
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (probe: boolean) => {
    const r = await api.projectMissing(item.path, probe);
    setMiss(r.missing); setPresent(r.present_count); setProbed(r.probed);
    return r;
  }, [item.path]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setMiss(null); setProbed(false); setPointed({}); setErr(null); setNote(null);
    (async () => {
      try {
        await load(false);          // fast: show the full list immediately
        if (!alive) return;
        setLoading(false);
        await load(true);           // then walk the library to mark what's auto-findable
      } catch (e: any) {
        if (alive) { setErr(e.message || "Couldn't read this project."); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [item.path, load]);

  async function runBackup(opts: Record<string, unknown>, tag: string, okMsg: string) {
    setErr(null); setNote(null); setBusy(tag);
    try {
      const { job_id } = await api.startBackup({
        als_paths: [item.path], portable: true, layout: "project_date", find_missing: true, ...opts,
      });
      for (;;) {
        const st = await api.jobStatus(job_id);
        if (st.state === "done" || st.state === "error") {
          if (st.state === "error") throw new Error(st.error || "Backup failed.");
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      const after = await load(true);
      onChanged?.();
      setNote(after.missing_count === 0
        ? "Every sample found and saved in a checked backup."
        : okMsg.replace("{n}", String(after.missing_count)));
    } catch (e: any) {
      setErr(e.message || "That didn't work — check a backup destination is set in Settings.");
    } finally {
      setBusy(null);
    }
  }

  const fixNow = () =>
    runBackup({}, "fix", "Found and backed up what we could · {n} still need you to point them out.");
  async function lookInFolder() {
    const dir = await bridge()?.pickFolder?.();
    if (dir) runBackup({ libraries: [dir] }, "folder", "Searched that folder · {n} still missing.");
  }
  async function pointToFile(m: Miss) {
    const file = await bridge()?.pickFile?.();
    if (!file) return;
    setPointed((p) => ({ ...p, [m.expected_path]: file }));
    runBackup({ relink_map: { [m.expected_path]: file } }, m.expected_path, "{n} still missing.");
  }

  const working = busy !== null;
  const recoverable = (miss ?? []).filter((m) => m.recoverable).length;
  const lost = (miss ?? []).length - recoverable;

  return (
    <div className="miss">
      <div className="miss-head">
        <div style={{ minWidth: 0 }}>
          <div className="miss-sum">
            {loading || miss === null
              ? "Reading the project…"
              : miss.length === 0
              ? <span className="ok">Nothing missing — every sample is where the project expects it.</span>
              : !probed
              ? <>{miss.length} sample{miss.length === 1 ? "" : "s"} the project can’t find on disk · <span className="dim">checking your library…</span></>
              : recoverable > 0 && lost > 0
              ? <><span className="found">{recoverable} found in your library</span> · <span className="lost">{lost} need you to point them out</span></>
              : lost === 0
              ? <span className="found">All {miss.length} are in your library — Fix now backs them up.</span>
              : <span className="lost">{lost} couldn’t be found anywhere — point me to them.</span>}
          </div>
        </div>
        {!!miss?.length && (
          <div className="miss-actions">
            <Button variant="ghost" onClick={lookInFolder} disabled={working}>
              {busy === "folder" ? "Searching…" : "Look in a folder…"}
            </Button>
            <Button onClick={fixNow} disabled={working}>
              {busy === "fix" ? "Fixing…" : "Fix now"}
            </Button>
          </div>
        )}
      </div>

      <p className="miss-trust">
        Files <strong>{item.name}</strong> uses that aren’t where it expects them.
        {item.backed_up ? " Your last backup still holds a checked copy of everything else." : ""}
        {" "}<strong>Fix now</strong> searches your sample folders from Settings, your project folders and FL Studio’s own folder.
        For anything it can’t find, <strong>Point to file</strong> lets you choose the exact one.
      </p>

      {note && <div className="miss-note ok">{note}</div>}
      {err && <div className="miss-note err">{err}</div>}

      {!!miss?.length && (
        <div className="table miss-list">
          <div className="row cols cols-head miss-cols"><span /><span>Sample</span><span>Where it stands</span><span /></div>
          {miss.map((m) => {
            const onRow = busy === m.expected_path;
            const handPicked = pointed[m.expected_path];
            return (
              <div key={m.expected_path} className="row cols miss-cols">
                <span className={`dot ${handPicked || m.recoverable ? "dot--ok" : probed ? "dot--warn" : ""}`} />
                <div className="miss-file">
                  <div className="miss-name" title={m.name}>{m.name}</div>
                  <div className="miss-path mono" title={m.expected_path}>{m.expected_path}</div>
                </div>
                <span className={`miss-badge col-trunc ${handPicked ? "pointed" : !probed ? "checking" : m.recoverable ? "found" : "lost"}`}>
                  {handPicked ? `Using ${handPicked.split(/[\\/]/).pop()}`
                    : !probed ? "Checking…"
                    : m.recoverable ? "Found in your samples"
                    : "Not found anywhere"}
                </span>
                <span className="col-act">
                  <Button size="sm" variant="ghost" onClick={() => pointToFile(m)} disabled={working}
                    title="Pick the exact replacement file for this sample">
                    {onRow ? "Linking…" : "Point to file"}
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {present > 0 && !loading && (
        <div className="miss-foot">{present} other sample{present === 1 ? " is" : "s are"} where the project expects.</div>
      )}
    </div>
  );
}
