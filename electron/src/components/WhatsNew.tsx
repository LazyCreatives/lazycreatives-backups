import { Fragment, useEffect, useRef, useState } from "react";
import { useLook } from "../look";
import { Icon } from "./Icon";
import { useDialogFocus } from "./a11y";
import { useLeave } from "./Desktop";

// The "What's new in <version>" panel. It opens by itself the first time the app
// starts after an update, and from the "What's new" button next to Check for
// updates in Settings. The notes come from the CHANGELOG.md that ships inside the
// app (see electron/updater.js), so it works offline.
// Same file in both apps: it finds whichever app's bridge is there.

export type NoteItem = { title: string; detail: string };
export type NoteGroup = { kind: string; items: NoteItem[] };
export type Notes = { version: string; groups: NoteGroup[] };

type Bridge = { whatsNew?: () => Promise<Notes> };
const bridge = (): Bridge | undefined => (window as any).ablebackup ?? (window as any).lazyupload;

const SEEN = "lc-seen-version";
const OPEN = "lc-whats-new";

// Should the panel open by itself? Only when the version changed since the app
// last ran. A fresh install has no record yet, so it is only shown when the app
// was already set up (an update from a version before this panel existed).
export function shouldShow(version: string, seen: string | null, setUp: boolean): boolean {
  if (!version) return false;
  if (seen === null) return setUp;
  return seen !== version;
}

// Opens the panel from anywhere (the Settings button), optionally with another
// version's notes (an update that is waiting to be installed).
export function openWhatsNew(notes?: Notes) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: notes }));
}

// Mounted once in App. `setUp` says whether the app was already set up when it opened.
export function WhatsNewHost({ setUp }: { setUp: boolean }) {
  const [own, setOwn] = useState<Notes | null>(null);
  const [shown, setShown] = useState<Notes | null>(null);

  useEffect(() => {
    let live = true;
    bridge()?.whatsNew?.().then((n) => {
      if (!live || !n) return;
      setOwn(n);
      let seen: string | null = null;
      try { seen = localStorage.getItem(SEEN); } catch { /* treat as unknown */ }
      if (shouldShow(n.version, seen, setUp) && n.groups.length > 0) setShown(n);
      else remember(n.version);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const h = (e: Event) => {
      const n = (e as CustomEvent<Notes | undefined>).detail ?? own;
      if (n) setShown(n);
    };
    window.addEventListener(OPEN, h);
    return () => window.removeEventListener(OPEN, h);
  }, [own]);

  if (!shown) return null;
  const close = () => { if (own) remember(own.version); setShown(null); };
  return <WhatsNewPanel notes={shown} upcoming={!!own && shown.version !== own.version} onClose={close} />;
}

function remember(version: string) {
  try { localStorage.setItem(SEEN, version); } catch { /* shows again next time */ }
}

// **bold** words inside a note's detail.
function Inline({ text }: { text: string }) {
  const parts = text.split("**");
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>))}</>;
}

const SIDE: Record<string, string> = { New: "A", Better: "B", Fixed: "C" };

export function WhatsNewPanel({ notes, upcoming = false, onClose: close }: {
  notes: Notes; upcoming?: boolean; onClose: () => void;
}) {
  const [look] = useLook();
  const [leaving, onClose] = useLeave(close);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(boxRef);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  let n = 0;
  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={onClose}>
      <div ref={boxRef} className="wnew" role="dialog" aria-modal="true" aria-labelledby="wnew-title" onClick={(e) => e.stopPropagation()}>
        <header className="wnew__head">
          {look === "sleeve" && (
            <div className="wnew__disc" aria-hidden="true"><span className="mono">{notes.version}</span></div>
          )}
          <div className="wnew__heading">
            <div className="eyebrow">{upcoming ? "Coming in the next update" : "You're on the latest version"}</div>
            <h2 id="wnew-title">What's new in <span className="mono wnew__ver">{notes.version}</span></h2>
          </div>
          <button type="button" className="wnew__close" aria-label="Close" onClick={onClose}><Icon name="close" size={14} /></button>
        </header>

        <div className="wnew__list">
          {notes.groups.map((g) => g.items.map((it, i) => {
            n++;
            const no = look === "sleeve" ? `${SIDE[g.kind] ?? "D"}${i + 1}` : String(n).padStart(2, "0");
            const kind = g.kind.toLowerCase();
            return (
              <div key={`${g.kind}-${i}`} className={`wnew__row wnew__row--${kind}`}>
                <span className="wnew__no mono">{no}</span>
                <span className={`wnew__tag wnew__tag--${kind}`}>{g.kind}</span>
                <div className="wnew__text">
                  <strong>{it.title}</strong>
                  {it.detail && <span><Inline text={it.detail} /></span>}
                </div>
              </div>
            );
          }))}
        </div>

        <footer className="wnew__foot">
          <span className="faint">
            {upcoming ? "Install the update to get these." : "You can open this again from Settings, under Updates."}
          </span>
          <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>Got it</button>
        </footer>
      </div>
    </div>
  );
}
