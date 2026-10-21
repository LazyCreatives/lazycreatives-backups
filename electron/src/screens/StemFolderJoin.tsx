import { useEffect, useMemo, useRef, useState } from "react";
import { toast, toastWarn, useLeave } from "../components/Desktop";
import { useDialogFocus } from "../components/a11y";
import { ProjectPick, type Guess } from "../components/ProjectPick";
import { makeApi } from "../api";
import { fmtCount, stemsOnly } from "../format";
import type { LibraryItem } from "../types";

const api = makeApi();
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

// "These stems belong to a project": a stems-only folder's stems join a project
// (they show on its Stems desk and go into its backups) and the folder stops being a
// project of its own. Only links change; no file is moved. Undo puts it back.
export function StemFolderJoin({ item, items, stems, onClose, onDone, onUndone }: {
  item: LibraryItem; items: LibraryItem[]; stems: number;
  onClose: () => void; onDone: () => void; onUndone: () => void;
}) {
  const [leaving, done] = useLeave(onClose);
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  const [pid, setPid] = useState("");
  const [busy, setBusy] = useState(false);
  const projects = useMemo(() => items.filter((i) => i.project_id !== item.project_id && !stemsOnly(i.daw)), [items, item]);
  // projects sharing a word with the folder's name ("Night Drive" for "Night Drive v3")
  const guesses: Guess[] = useMemo(() => {
    const mine = new Set(wordsOf(item.name));
    return projects.filter((p) => wordsOf(p.name).some((w) => mine.has(w))).slice(0, 4)
      .map((p) => ({ project_id: p.project_id, why: "shares a word with this folder's name" }));
  }, [projects, item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  async function join() {
    setBusy(true);
    try {
      const r = await api.joinStemFolder(item.project_id, pid);
      toast(`The stems now belong to ${r.project}.`, {
        label: "Undo", onClick: () => { api.undoJoinStemFolder(r.token).then(onUndone).catch(() => toastWarn("Couldn't undo that. Try again.")); },
      });
      onDone();
    } catch {
      toastWarn("Couldn't add the stems. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={() => done()}>
      <div ref={ref} className="wnew confirm sjoin" role="dialog" aria-modal="true" aria-labelledby="sjoin-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="fpick__head">
          <div className="eyebrow">Stems only</div>
          <h2 id="sjoin-title" className="col-trunc" title={item.name}>Which project are these stems from?</h2>
          <p className="fpick__now">
            The {fmtCount(stems)} stem{stems === 1 ? "" : "s"} in {item.name} join that project's Stems desk and backups,
            and {item.name} stops showing as a project of its own. Your files stay where they are.
          </p>
        </div>
        <div className="sjoin__pick">
          <ProjectPick items={projects} value={pid} guesses={guesses} song={item.name} onPick={setPid} />
        </div>
        <div className="confirm__foot">
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={() => done()}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={busy || !pid} onClick={() => void join()}>Add the stems</button>
        </div>
      </div>
    </div>
  );
}
