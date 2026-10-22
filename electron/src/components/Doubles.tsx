import { useEffect, useState } from "react";
import { makeApi, type Doubles as Found } from "../api";
import { Button } from "./Button";
import { askConfirm, toast } from "./Desktop";
import { stampWords } from "./BackupSort";
import { fmtCount, fmtSize } from "../format";

const api = makeApi();
const copies = (n: number) => `${fmtCount(n)} extra cop${n === 1 ? "y" : "ies"}`;

/** Same backup twice (Settings, Backups): backups of a project that hold exactly the
 *  same thing, made when an unchanged project was backed up again with another option.
 *  The newest of each is kept; the others go only when you press Remove. Named
 *  backups always stay, and your own projects are never touched. */
export function Doubles({ dest, loaded }: { dest: string; loaded: boolean }) {
  const [found, setFound] = useState<Found | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function look() {
    api.doubles().then(setFound).catch(() => setFound({ groups: [], count: 0, size: 0 }));
  }
  useEffect(() => { if (loaded) look(); }, [dest, loaded]);

  async function remove() {
    if (!found) return;
    const ok = await askConfirm({
      title: `Remove ${copies(found.count)}?`,
      body: "The newest backup of each project stays, with everything in it. Only the copies that hold exactly the same thing go. Your projects aren't touched.",
      confirm: "Remove", danger: true,
    });
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.removeDoubles();
      toast(r.freed > 0 ? `Removed ${copies(r.removed)}. ${fmtSize(r.freed)} free again.` : `Removed ${copies(r.removed)}.`);
      if (r.failed) setErr(`${copies(r.failed)} couldn't be removed and stayed where ${r.failed === 1 ? "it was" : "they were"}.`);
      setOpen(false);
      look();
    } catch (e: any) {
      setErr(e.message || "Couldn't remove them. Every backup is still there.");
    } finally { setBusy(false); }
  }

  if (!found) return <p className="set-note">Looking…</p>;
  if (!found.count) return <p className="set-note">None. Every backup holds something different.</p>;
  return (
    <div className="doubles">
      <div className="set-inline">
        <p className="set-note">
          {copies(found.count)} across {fmtCount(found.groups.length)} project{found.groups.length === 1 ? "" : "s"}
          {found.size > 0 && <>, using {fmtSize(found.size)}</>}.
        </p>
        <Button size="sm" variant="quiet" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show them"}</Button>
        <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>{busy ? "Removing…" : `Remove ${copies(found.count)}`}</Button>
      </div>
      {open && (
        <div className="table doubles-cols">
          <div className="row cols cols-head" aria-hidden><span>Project</span><span>Kept</span><span>Extra copies</span></div>
          <div role="list" className="doubles__rows">
            {found.groups.map((g) => (
              <div key={g.keep.id} className="row cols" role="listitem">
                <span className="col-trunc" title={g.project_name}><bdi>{g.project_name}</bdi></span>
                <span className="faint col-trunc">{stampWords(g.keep.timestamp)}</span>
                <span className="faint col-trunc" title={g.extras.map((e) => stampWords(e.timestamp)).join("\n")}>
                  {g.extras.length === 1 ? stampWords(g.extras[0].timestamp) : `${fmtCount(g.extras.length)} copies`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {err && <p className="set-note set-note--bad" role="alert">{err}</p>}
    </div>
  );
}
