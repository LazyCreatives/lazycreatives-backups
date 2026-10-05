import { useEffect, useRef, useState } from "react";
import { GENRES, genreColor } from "../look";
import { Cover } from "./Cover";

// Correct a project's (or a mix's) genre. The apps guess a genre from tempo and
// name; this box lets the producer pick the right one, type their own, or go back
// to the guess. The cover in the box follows the pick, so they see the new colour
// before saving. SHARED FILE: the same file lives in Backups and Uploader
// (electron/src/components/GenrePick.tsx); change both together. Styles are in
// lazy-ui.css (.gpick, .genrechip, .genre-guess), in both looks.

export type GenrePickOpts = {
  title: string;               // what is being changed, e.g. "Glasshouse"
  cover: string;               // name the cover art is drawn from
  current: string | null;      // the genre it has now
  setByYou: boolean;           // true when the producer already picked it
  guess?: string | null;       // what the app guessed (for "Use the guess")
  resetLabel?: string;         // wording for that button, if not "Use the guess"
  why?: string;                // a few words on where the guess came from
  note?: string;               // an extra line, e.g. "Uploader follows this too"
  count?: number;              // more than 1 when several are being changed at once
  yours?: string[];            // genres the producer typed before, listed under "Your genres"
};
// The pick: a genre name, null for "go back to the guess", or undefined when cancelled.
export type GenrePickResult = string | null | undefined;
type PickState = (GenrePickOpts & { resolve: (g: GenrePickResult) => void }) | null;
const pickSubs = new Set<(s: PickState) => void>();

export function pickGenre(opts: GenrePickOpts): Promise<GenrePickResult> {
  if (!pickSubs.size) return Promise.resolve(undefined);
  return new Promise((resolve) => pickSubs.forEach((f) => f({ ...opts, resolve })));
}

const OTHER = "__other__";

// Rendered once in the app; shows the genre box when something asks for it.
export function GenrePickHost() {
  const [s, setS] = useState<PickState>(null);
  useEffect(() => { pickSubs.add(setS); return () => { pickSubs.delete(setS); }; }, []);
  if (!s) return null;
  return <GenreBox key={`${s.title}|${s.current}`} s={s} done={(g) => { s.resolve(g); setS(null); }} />;
}

function GenreBox({ s, done }: { s: NonNullable<PickState>; done: (g: GenrePickResult) => void }) {
  const yours = [...new Set((s.yours ?? []).filter((g) => g && !GENRES.includes(g)))].sort((a, b) => a.localeCompare(b));
  const known = !s.current || GENRES.includes(s.current) || yours.includes(s.current);
  const [choice, setChoice] = useState<string>(s.current ? (known ? s.current : OTHER) : "");
  const [own, setOwn] = useState<string>(known ? "" : s.current ?? "");
  const ref = useRef<HTMLDivElement | null>(null);
  const picked = choice === OTHER ? own.trim() : choice;
  const changed = picked !== (s.current ?? "") || (!s.setByYou && !!picked);

  useEffect(() => {
    ref.current?.querySelector<HTMLSelectElement>("select")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(undefined); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const save = () => { if (picked) done(picked.slice(0, 40)); };
  const many = (s.count ?? 1) > 1;
  return (
    <div className="wnew__scrim" onClick={() => done(undefined)}>
      <div ref={ref} className="wnew confirm gpick" role="dialog" aria-modal="true" aria-labelledby="gpick-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); save(); } }}>
        <div className="gpick__body">
          <div className="gpick__art" aria-hidden>
            <Cover name={s.cover} genre={picked || s.current} size={92} />
          </div>
          <div className="gpick__main">
            <div className="eyebrow">{many ? `${s.count} projects` : "Genre"}</div>
            <h2 id="gpick-title" className="col-trunc" title={s.title}>{s.title}</h2>
            <p className="gpick__now">
              {s.current
                ? s.setByYou
                  ? <>Set by you to <b>{s.current}</b>.</>
                  : <>We guessed <b>{s.current}</b>{s.why ? ` ${s.why}` : ""}.</>
                : "No genre yet."}
            </p>
            <label className="gpick__field">
              <span className="gpick__swatch" style={{ background: genreColor(picked || null) }} />
              <select value={choice} aria-label="Genre" onChange={(e) => setChoice(e.target.value)}>
                {!s.current && <option value="">Pick a genre</option>}
                {yours.length > 0 && (
                  <optgroup label="Your genres">
                    {yours.map((g) => <option key={g} value={g}>{g}</option>)}
                  </optgroup>
                )}
                {yours.length > 0
                  ? <optgroup label="All genres">{GENRES.map((g) => <option key={g} value={g}>{g}</option>)}</optgroup>
                  : GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                <option value={OTHER}>Something else…</option>
              </select>
            </label>
            {choice === OTHER && (
              <input type="text" className="gpick__own" value={own} maxLength={40} autoFocus
                placeholder="Type the genre, e.g. Afrobeats" onChange={(e) => setOwn(e.target.value)} />
            )}
            {s.note && <p className="gpick__note">{s.note}</p>}
          </div>
        </div>
        <div className="confirm__foot gpick__foot">
          {s.setByYou && s.guess !== undefined && (
            <button type="button" className="linkbtn gpick__reset" onClick={() => done(null)}
              title="Forget your pick">
              {s.resetLabel ?? "Use the guess"}{s.guess ? ` (${s.guess})` : ""}
            </button>
          )}
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={() => done(undefined)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!picked || !changed} onClick={save}>Save genre</button>
        </div>
      </div>
    </div>
  );
}

// A small genre label with its colour that opens the box, for page headers.
// "guessed" shows as a dotted underline and a word, "set by you" as plain text.
export function GenreChip({ genre, setByYou, onClick, className = "" }: {
  genre: string | null; setByYou: boolean; onClick: () => void; className?: string;
}) {
  const label = genre ? (setByYou ? "Genre set by you. Click to change" : "Genre guessed from tempo and name. Click to correct it")
    : "No genre yet. Click to set one";
  return (
    <button type="button" className={`genrechip${setByYou ? " genrechip--set" : ""} ${className}`.trim()}
      title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <span className="genrechip__dot" style={{ background: genreColor(genre) }} />
      <span className={setByYou || !genre ? "" : "genre-guess"}>{genre || "Set genre"}</span>
      {genre && <span className="genrechip__how">{setByYou ? "set by you" : "guessed"}</span>}
      <svg className="genrechip__pen" viewBox="0 0 16 16" width="11" height="11" aria-hidden>
        <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
