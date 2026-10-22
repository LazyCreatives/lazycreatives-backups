import { useEffect, useRef, useState } from "react";
import { makeApi, type FoundNas, type NasShare } from "../api";
import { useDialogFocus } from "./a11y";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Choice } from "./SetRow";

const api = makeApi();

type Step = "find" | "login" | "ready" | "share" | "away" | "address";
const STEP_NO: Partial<Record<Step, number>> = { find: 1, login: 2, ready: 3, share: 3 };
const DEFAULT_FOLDER = "Lazy Creatives Backups";
const TAILSCALE = "https://tailscale.com/download";
const openLink = (url: string) => (window as any).ablebackup?.openExternal?.(url);

/** "Find my NAS": the NAS boxes on this network (and, through Tailscale, ones away
 *  from home), a login typed once, then the shared folder to keep backups in.
 *  Backups connects it the computer's own way and makes a "Lazy Creatives Backups"
 *  folder inside it; nothing else on the NAS is touched. With `onRemote`, a NAS can
 *  also be added by its internet address as a second place backups are copied to. */
export function NasPicker({ onPicked, onRemote, onClose }: {
  onPicked: (dest: string, name: string) => void;
  onRemote?: (mirror: string, name: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("find");
  const [found, setFound] = useState<FoundNas[] | null>(null);
  const [ts, setTs] = useState<{ installed: boolean; running: boolean }>({ installed: false, running: false });
  const [typed, setTyped] = useState("");
  const [box, setBox] = useState<FoundNas | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [shares, setShares] = useState<NasShare[]>([]);
  // false when the NAS wouldn't list its folders (or the login check looked wrong): type the name
  const [listed, setListed] = useState(true);
  const [typedShare, setTypedShare] = useState("");
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  // The place Backups picked by itself, shown before it's used ("Change" opens the list).
  const [picked, setPicked] = useState<{ dest: string; share: string; folder: string } | null>(null);
  const [remote, setRemote] = useState({ kind: "sftp" as "sftp" | "webdav", host: "", port: "", folder: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const pwRef = useRef<HTMLInputElement | null>(null);
  useDialogFocus(ref);

  function look() {
    setFound(null); setErr(null);
    api.findNas().then((r) => { setFound(r.found); setTs(r.tailscale); }).catch(() => setFound([]));
  }
  useEffect(look, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  function go(s: Step) { setStep(s); setErr(null); }
  function choose(n: FoundNas) { setBox(n); go("login"); }
  function chooseTyped() {
    const t = typed.trim();
    if (t) choose({ name: t, host: t, address: "", maker: "" });
  }
  async function logIn() {
    setBusy("login"); setErr(null);
    try {
      const r = await api.nasShares(box!.host, user, password);
      setBox({ ...box!, host: r.host, name: box!.name === box!.host ? r.host : box!.name });
      setShares(r.shares);
      setListed(r.listed !== false);
      // A pasted \\NAS\Music already says which folder: go straight on.
      const pasted = r.shares.find((s) => s.name.toLowerCase() === r.pasted_share.toLowerCase())?.name
        ?? (r.listed === false && r.pasted_share ? r.pasted_share : undefined);
      if (pasted) { go("share"); await connect(pasted, r.host); return; }
      if (r.listed === false || !r.shares.length) { go("share"); return; }
      // Pick the shared folder by itself; the producer only has to say "Done".
      setBusy("auto");
      try {
        const c = await api.nasConnect({ host: r.host, share: "", folder: DEFAULT_FOLDER, user, password, name: box!.name, address: box!.address });
        setPicked({ dest: c.dest, share: c.share ?? "", folder: c.folder ?? DEFAULT_FOLDER });
        go("ready");
      } catch (e: any) { go("share"); setErr(e.message); }
    } catch (e: any) {
      setErr(e.message);
      pwRef.current?.select();
    } finally { setBusy(null); }
  }
  async function connect(share: string, host = box!.host) {
    setBusy(share); setErr(null);
    try {
      const r = await api.nasConnect({ host, share, folder: folder.trim() || DEFAULT_FOLDER, user, password, name: box!.name, address: box!.address });
      onPicked(r.dest, `${box!.name} › ${share}`);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }
  async function addRemote() {
    setBusy("remote"); setErr(null);
    try {
      const r = await api.nasRemote({ kind: remote.kind, host: remote.host, port: remote.port ? Number(remote.port) : null,
        user, password, folder: remote.folder });
      onRemote!(r.mirror, remote.host);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }

  const title = { find: "Find your NAS", login: "Log in to your NAS", ready: "Your backups go here", share: "Pick where backups go",
    away: "A NAS away from home", address: "Use its internet address" }[step];
  const sub = step === "login" || step === "share" ? box?.name : undefined;
  const away = (found ?? []).filter((n) => n.away);
  const home = (found ?? []).filter((n) => !n.away);
  const rows = [...home, ...away];
  const error = err && <p className="set-note set-note--bad" role="alert">{err}</p>;

  return (
    <div className="modal__scrim nasp__scrim" onClick={() => { if (!busy) onClose(); }}>
      <div ref={ref} className="modal nasp" role="dialog" aria-modal="true" aria-labelledby="nasp-title" onClick={(e) => e.stopPropagation()}>
        <div className="nasp__head">
          <div className="nasp__titles">
            {STEP_NO[step] && <span className="nasp__step">Step {STEP_NO[step]} of 3</span>}
            <h2 id="nasp-title">{title}</h2>
            {sub && <span className="nasp__sub col-trunc" title={sub}><bdi>{sub}</bdi></span>}
          </div>
          <button type="button" className="nasp__x" aria-label="Close" onClick={onClose} disabled={!!busy}><Icon name="close" size={16} /></button>
        </div>

        {step === "find" && <>
          <p className="sub nasp__say">NAS boxes, and computers sharing folders, on this network. Pick yours.</p>
          {found === null ? (
            <p className="nasp__wait" role="status"><span className="nasp__dot" aria-hidden />Looking on your network…</p>
          ) : rows.length === 0 ? (
            <p className="nasp__none">No NAS answered. Check it's switched on and connected to the same network as this computer, or type its address below.</p>
          ) : (
            <div className="table nasp-cols">
              <div className="row cols cols-head" aria-hidden><span /><span>Name</span><span className="nasp__maker">Made by</span><span>Address</span><span /></div>
              <div role="list" className="nasp__rows">
                {rows.map((n) => (
                  <div key={n.host} className="row cols" role="listitem">
                    <Icon name="nas" size={15} className="faint" />
                    <span className="col-trunc nasp__name" title={n.name}><bdi>{n.name}</bdi></span>
                    <span className="faint col-trunc nasp__maker" title={n.via ? `Through ${n.via} (Tailscale)` : undefined}>{n.via ? `Through ${n.via} (Tailscale)` : n.away ? "Away (Tailscale)" : n.maker || "File sharing"}</span>
                    <span className="mono faint col-trunc nasp__addr" title={n.address}>{n.address}</span>
                    <span className="col-act"><Button size="sm" variant="ghost" onClick={() => choose(n)} aria-label={`Use ${n.name}`}>Use</Button></span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <form className="nasp__typed" onSubmit={(e) => { e.preventDefault(); chooseTyped(); }}>
            <label className="field">
              <span>{rows.length ? "Not listed? Type its name or address" : "Type its name or address"}</span>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder="192.168.1.20, tnas.local or \\TNAS\Music" spellCheck={false} />
            </label>
            <div className="set-inline">
              <Button size="sm" type="submit" disabled={!typed.trim()}>Next</Button>
              <Button size="sm" variant="quiet" type="button" onClick={look} disabled={found === null}>Look again</Button>
              <button type="button" className="linkbtn nasp__awaylink" onClick={() => go("away")}>NAS not at home?</button>
            </div>
          </form>
        </>}

        {step === "login" && (
          <form className="nasp__login" onSubmit={(e) => { e.preventDefault(); logIn(); }}>
            <p className="sub nasp__say">The user name and password you made on the NAS (often the one you log in to its web page with). They're kept locked on this computer, so Backups can connect it again by itself.</p>
            <label className="field"><span>User name</span>
              <input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" spellCheck={false} autoFocus />
            </label>
            <div className="field"><label htmlFor="nasp-pw">Password</label>
              <span className="nasp__pw">
                <input id="nasp-pw" ref={pwRef} className="input" type={show ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-invalid={!!err} aria-describedby={err ? "nasp-err" : undefined} />
                <Button size="sm" variant="quiet" type="button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</Button>
              </span>
              {err && <span id="nasp-err" className="set-note set-note--bad" role="alert">{err}</span>}
              {err && /name or password/.test(err) && (
                <button type="button" className="linkbtn nasp__sure" onClick={() => { setShares([]); setListed(false); go("share"); }}>
                  Sure they're right? Type the shared folder's name instead
                </button>
              )}
            </div>
            <div className="set-inline">
              <Button size="sm" type="submit" disabled={!!busy}>{busy === "auto" ? "Finding a place…" : busy ? "Logging in…" : "Log in"}</Button>
              <Button size="sm" variant="quiet" type="button" disabled={!!busy} onClick={() => go("find")}>Back</Button>
            </div>
          </form>
        )}

        {step === "ready" && picked && <>
          <p className="sub nasp__say">Every backup goes in this folder on the NAS. Backups connects it by itself before each backup, and nothing else on the NAS is touched.</p>
          <div className="nasp__where" role="group" aria-label="Where backups go">
            <Icon name="nas" size={15} className="faint" />
            <span className="col-trunc" title={box!.name}><bdi>{box!.name}</bdi></span>
            <span className="faint" aria-hidden>›</span>
            <span className="col-trunc" title={picked.share}><bdi>{picked.share}</bdi></span>
            <span className="faint" aria-hidden>›</span>
            <span className="col-trunc nasp__where-folder" title={picked.folder}><bdi>{picked.folder}</bdi></span>
          </div>
          <div className="set-inline">
            <Button size="sm" onClick={() => onPicked(picked.dest, `${box!.name} › ${picked.share}`)} autoFocus>Done</Button>
            <Button size="sm" variant="quiet" onClick={() => go("share")}>Change</Button>
          </div>
        </>}

        {step === "share" && <>
          <p className="sub nasp__say">Pick one of the NAS's shared folders. Backups makes its own folder inside it, so nothing else there is touched.</p>
          <label className="field nasp__folder">
            <span>Name of the folder Backups makes</span>
            <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} maxLength={80} spellCheck={false} />
          </label>
          {!listed ? (
            <p className="nasp__none">The NAS didn't list its shared folders, so type the name of the one to use, written the way the NAS shows it. This computer checks the login when it connects.</p>
          ) : shares.length === 0 ? (
            <p className="nasp__none">This login can't see any shared folders. Make one on the NAS, or log in as someone who can.</p>
          ) : (
            <div className="table nasp-share-cols">
              <div className="row cols cols-head" aria-hidden><span /><span>Shared folder</span><span>Description</span><span /></div>
              <div role="list" className="nasp__rows">
                {shares.map((s) => (
                  <div key={s.name} className="row cols" role="listitem">
                    <Icon name="folder" size={15} className="faint" />
                    <span className="col-trunc nasp__name" title={s.name}><bdi>{s.name}</bdi></span>
                    <span className="faint col-trunc nasp__comment" title={s.comment}><bdi>{s.comment}</bdi></span>
                    <span className="col-act">
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => connect(s.name)} aria-label={`Keep backups in ${s.name}`}>
                        {busy === s.name ? "Connecting…" : "Use"}
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <form className="nasp__typed" onSubmit={(e) => { e.preventDefault(); if (typedShare.trim()) connect(typedShare.trim().replace(/^[\\/]+|[\\/]+$/g, "")); }}>
            <label className="field">
              <span>{listed && shares.length ? "Not listed? Type its name" : "Shared folder's name"}</span>
              <input className="input" value={typedShare} onChange={(e) => setTypedShare(e.target.value)}
                placeholder="Music" spellCheck={false} autoFocus={!listed} />
            </label>
            <div className="set-inline">
              <Button size="sm" type="submit" disabled={!typedShare.trim() || !!busy}>{busy === typedShare.trim() ? "Connecting…" : "Use"}</Button>
            </div>
          </form>
          {error}
          <div className="set-inline"><Button size="sm" variant="quiet" disabled={!!busy} onClick={() => go(picked ? "ready" : "login")}>Back</Button></div>
        </>}

        {step === "away" && <>
          <p className="sub nasp__say">The easiest way is Tailscale, a free app that links this computer and your NAS privately over the internet. Your NAS then shows up here as if it were at home, and space saving keeps working.</p>
          <ol className="nasp__steps">
            <li><span className="nasp__n">1</span><span>Install Tailscale on this computer and sign in.</span>
              {ts.installed ? <span className="pill pill--ok nasp__after">{ts.running ? "Done" : "Installed, not signed in"}</span>
                : <Button size="sm" variant="ghost" className="nasp__after" onClick={() => openLink(TAILSCALE)}>Get Tailscale<Icon name="external" size={13} /></Button>}</li>
            <li><span className="nasp__n">2</span><span>On the NAS, add Tailscale from its app centre (Synology, QNAP, TerraMaster, Asustor and others have it) and sign in with the same account.</span></li>
            <li><span className="nasp__n">3</span><span>Come back here and press Look again.</span></li>
          </ol>
          <div className="set-inline">
            <Button size="sm" onClick={() => { go("find"); look(); }}>Look again</Button>
            <Button size="sm" variant="quiet" onClick={() => go("find")}>Back</Button>
            {onRemote && <button type="button" className="linkbtn" onClick={() => go("address")}>No Tailscale? Use its internet address</button>}
          </div>
        </>}

        {step === "address" && onRemote && (
          <form className="nasp__login" onSubmit={(e) => { e.preventDefault(); addRemote(); }}>
            <p className="sub nasp__say">Every backup is also copied to the NAS over the internet, as a second copy. Each copy is a full one, so it takes more room than at home. The NAS's router must let SFTP or WebDAV through.</p>
            <Choice label="How the NAS is reached" value={remote.kind} options={[["sftp", "SFTP"], ["webdav", "WebDAV"]] as const}
              onChange={(k) => setRemote({ ...remote, kind: k })} />
            <span className="nasp__pair">
              <label className="field"><span>Internet address</span>
                <input className="input" value={remote.host} onChange={(e) => setRemote({ ...remote, host: e.target.value })}
                  placeholder="myhouse.ddns.net or 81.2.69.160" spellCheck={false} autoFocus /></label>
              <label className="field nasp__port"><span>Port</span>
                <input className="input" inputMode="numeric" value={remote.port} onChange={(e) => setRemote({ ...remote, port: e.target.value.replace(/\D/g, "") })}
                  placeholder={remote.kind === "sftp" ? "22" : "5006"} /></label>
            </span>
            <label className="field"><span>Shared folder on the NAS</span>
              <input className="input" value={remote.folder} onChange={(e) => setRemote({ ...remote, folder: e.target.value })} placeholder="Music" spellCheck={false} /></label>
            <span className="nasp__pair">
              <label className="field"><span>User name</span>
                <input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" spellCheck={false} /></label>
              <label className="field"><span>Password</span>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            </span>
            {error}
            <div className="set-inline">
              <Button size="sm" type="submit" disabled={!!busy || !remote.host.trim()}>{busy ? "Checking…" : "Add second copy"}</Button>
              <Button size="sm" variant="quiet" type="button" disabled={!!busy} onClick={() => go("away")}>Back</Button>
            </div>
          </form>
        )}

        {step === "find" && error}
      </div>
    </div>
  );
}
