import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { Config, SuggestedFolder } from "../types";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { WelcomeCard, WelcomeLook } from "../components/Welcome";
import { fadeSwitch } from "../fade";
import { SlothSpot } from "../components/SlothSpot";
import { DestChoices, type DestChoice } from "../components/DestChoices";
import "../setup.css";

const api = makeApi();

const projectsWord = (n: number) => `${n} project${n === 1 ? "" : "s"}`;

// First run: say hello and pick a look, then the project folders (the usual ones on
// this computer come ready-ticked), then where backups go, or skip backups and just
// browse (skipped = true).
export function Setup({ onDone }: { onDone: (c: Config, skipped: boolean) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [found, setFound] = useState<SuggestedFolder[] | null>(null);  // null while looking
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);                     // added by hand
  const [dest, setDest] = useState("");
  const [choice, setChoice] = useState<DestChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Start looking straight away, so the list is ready by step 2.
  useEffect(() => {
    let live = true;
    api.suggestedFolders()
      .then((f) => { if (live) { setFound(f); setTicked(new Set(f.map((x) => x.path))); } })
      .catch(() => { if (live) setFound([]); });
    return () => { live = false; };
  }, []);

  const sources = [...(found ?? []).filter((f) => ticked.has(f.path)).map((f) => f.path), ...extra];

  function toggle(path: string) {
    const next = new Set(ticked);
    if (next.has(path)) next.delete(path); else next.add(path);
    setTicked(next);
  }
  async function addSource() {
    const dir = await (window as any).ablebackup.pickFolder();
    if (!dir) return;
    if (found?.some((f) => f.path === dir)) { setTicked(new Set(ticked).add(dir)); return; }
    if (!extra.includes(dir)) setExtra([...extra, dir]);
  }
  async function finish(skip: boolean) {
    setSaving(true); setErr(null);
    try {
      const c = await api.saveSettings({ sources, dest: skip ? "" : dest, interval_minutes: 0, libraries: [] });
      onDone(c, skip);
    } catch (e: any) { setErr(e.message || "Couldn't save settings"); setSaving(false); }
  }

  const back = step > 1
    ? <Button variant="ghost" onClick={() => setStep((step - 1) as 1 | 2)}>Back</Button>
    : <span />;

  if (step === 1) {
    return (
      <WelcomeCard app="Backups" step={1} title="Browse every project. No backup needed."
        sub="You make the music. We'll handle the files."
        foot={<>{back}<Button onClick={() => setStep(2)}>Next</Button></>}>
        {/* two plain lines, the way a sleeve's back says what's on the record */}
        <ul className="pitch">
          <li><b>Browse</b> every project on your computer in one list, whatever music program made it. Search by name, tempo or genre, and play the songs each one exported.</li>
          <li><b>Back up, if you want:</b> now, later or never. Every sample is followed and every copy is opened to check it works, so you never copy a project by hand again.</li>
        </ul>
        <WelcomeLook onPick={fadeSwitch} />
      </WelcomeCard>
    );
  }

  if (step === 2) {
    const any = (found?.length ?? 0) > 0;
    return (
      <WelcomeCard app="Backups" step={2} title="Where are your projects?"
        sub={found === null ? "Looking for your projects…"
          : any ? "We found these on your computer. Untick any you don't want in your library."
          : "Add the folders with your projects. Ableton, FL Studio, Logic Pro, Studio One, Reaper, Audacity and Bitwig projects are all found."}
        foot={<>{back}<Button onClick={() => setStep(3)} disabled={sources.length === 0}>Next</Button></>}>
        {found === null && <div className="setup-looking"><SlothSpot pose="searching" size={120} /></div>}
        {any && (
          <div className="suggest" role="group" aria-label="Project folders found">
            {found!.map((f) => (
              <label key={f.path} className={`suggest__row${ticked.has(f.path) ? " suggest__row--on" : ""}`} title={f.path}>
                <input type="checkbox" checked={ticked.has(f.path)} onChange={() => toggle(f.path)} />
                <Icon name="folder" className="suggest__icon" />
                <span className="suggest__name">{f.label}</span>
                <span className="suggest__count num">{projectsWord(f.count)}</span>
              </label>
            ))}
          </div>
        )}
        {extra.length > 0 && (
          <div className="suggest suggest--extra">
            {extra.map((s) => (
              <div key={s} className="suggest__row suggest__row--on" title={s}>
                <Icon name="folder" className="suggest__icon" />
                <span className="suggest__name">{s}</span>
                <button className="linkbtn" onClick={() => setExtra(extra.filter((x) => x !== s))} style={{ color: "var(--danger)" }}>remove</button>
              </div>
            ))}
          </div>
        )}
        {found !== null && (
          <Button variant="ghost" onClick={addSource}>{any || extra.length ? "+ Add another folder" : "+ Add a folder"}</Button>
        )}
        {found !== null && !any && extra.length === 0 && <p className="sub" style={{ margin: "12px 0 0" }}>No folders yet.</p>}
      </WelcomeCard>
    );
  }

  return (
    <WelcomeCard app="Backups" step={3} title="Back up too?"
      sub="Browsing needs nothing more. To keep checked copies as well, pick a drive, or a Dropbox or Google Drive folder that syncs to the cloud on its own."
      foot={<>{back}
        {/* Browsing is a full way to finish, not a skip. With no drive picked it's
            the main button; once one is picked, backing up leads and browsing stays
            right beside it. */}
        <div className="welcome__acts">
          {dest ? <>
            <Button variant="ghost" onClick={() => finish(true)} disabled={saving}>Just browse for now</Button>
            <Button onClick={() => finish(false)} disabled={saving}>{saving ? "Saving…" : "Back up & browse"}</Button>
          </> : (
            <Button onClick={() => finish(true)} disabled={saving}>{saving ? "Saving…" : "Browse my projects"}</Button>
          )}
        </div></>}>
      <DestChoices dest={dest} choice={choice} onPick={(d, c) => { setDest(d); setChoice(c); }} />
      <p className="welcome__skipnote">
        {dest
          ? "Or just browse for now. Backups are one click away whenever you want them, in Settings or on Home."
          : "No drive needed to browse every project. Pick one above to back up too, now or any time later."}
      </p>
      {err && <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", marginTop: 14 }}>{err}</div>}
    </WelcomeCard>
  );
}
