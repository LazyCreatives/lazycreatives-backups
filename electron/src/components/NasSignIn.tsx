import { useEffect, useRef, useState } from "react";
import { makeApi } from "../api";
import { useDialogFocus } from "./a11y";
import { Button } from "./Button";
import { toast } from "./Desktop";
import { Icon } from "./Icon";

const api = makeApi();

// "Log in to your NAS again": when the NAS turns down the saved login on this
// computer (a second computer, or the password changed on the NAS), a scan or Open
// asks for it here instead of quietly finding nothing. The new login replaces the
// saved one, locked on this computer, and whatever asked carries on.
type SignInState = { then?: () => void } | null;
const subs = new Set<(s: SignInState) => void>();

export function askNasSignIn(then?: () => void) {
  subs.forEach((f) => f({ then }));
}

// Rendered once in the app; shows the login box when something asks for it.
export function NasSignInHost() {
  const [s, setS] = useState<SignInState>(null);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  if (!s) return null;
  return <SignInBox done={(ok) => { setS(null); if (ok) s.then?.(); }} />;
}

function SignInBox({ done }: { done: (ok: boolean) => void }) {
  const [name, setName] = useState("your NAS");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const pwRef = useRef<HTMLInputElement | null>(null);
  useDialogFocus(ref);

  useEffect(() => {
    api.nasStatus().then((r) => {
      if (r.nas) { setName(r.nas.name); setUser((u) => u || r.nas!.user); }
      pwRef.current?.focus();
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) done(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  async function logIn() {
    setBusy(true); setErr(null);
    try {
      await api.nasSignIn(user, password);
      toast(`Logged in to ${name}.`);
      done(true);
    } catch (e: any) {
      setErr(e.message || "That name or password didn't work on the NAS.");
      setBusy(false);
      pwRef.current?.select();
    }
  }

  return (
    <div className="modal__scrim nasp__scrim" onClick={() => { if (!busy) done(false); }}>
      <div ref={ref} className="modal nasp" role="dialog" aria-modal="true" aria-labelledby="nass-title" onClick={(e) => e.stopPropagation()}>
        <div className="nasp__head">
          <div className="nasp__titles">
            <h2 id="nass-title">Log in to your NAS again</h2>
            <span className="nasp__sub col-trunc" title={name}><bdi>{name}</bdi></span>
          </div>
          <button type="button" className="nasp__x" aria-label="Close" onClick={() => done(false)} disabled={busy}><Icon name="close" size={16} /></button>
        </div>
        <form className="nasp__login" onSubmit={(e) => { e.preventDefault(); logIn(); }}>
          <p className="sub nasp__say">The NAS turned down the saved login on this computer. Type the user name and password you made on the NAS. They're kept locked on this computer, and replace the old ones.</p>
          <label className="field"><span>User name</span>
            <input className="input" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" spellCheck={false} />
          </label>
          <div className="field"><label htmlFor="nass-pw">Password</label>
            <span className="nasp__pw">
              <input id="nass-pw" ref={pwRef} className="input" type={show ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-invalid={!!err} aria-describedby={err ? "nass-err" : undefined} />
              <Button size="sm" variant="quiet" type="button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</Button>
            </span>
            {err && <span id="nass-err" className="set-note set-note--bad" role="alert">{err}</span>}
          </div>
          <div className="set-inline">
            <Button size="sm" type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</Button>
            <Button size="sm" variant="quiet" type="button" disabled={busy} onClick={() => done(false)}>Not now</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
