import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "./a11y";
import { CRATE_COLORS, GENRES, GENRE_GROUPS, builtInColor, genreColor, pickedColor, setGenreColor } from "../look";
import { Cover } from "./Cover";
import { useLeave } from "./Desktop";

// Correct a project's (or a mix's) genre. The apps guess a genre from tempo and
// name; this box lets the producer pick the right one, type their own, or go back
// to the guess. The cover in the box follows the pick, so they see the new colour
// before saving. SHARED FILE: the same file lives in Backups and Uploader
// (electron/src/components/GenrePick.tsx); change both together. Styles are in
// lazy-ui.css (.gpick, .genrechip, .genre-guess, .swatches), in both looks.
// The same box also picks a genre's crate colour (pickCrateColor, or the swatches
// under the genre), which every stripe, cover and crate of that genre then follows.

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

// Just the crate colour of one genre (right-click a crate or a genre).
type ColorState = { genre: string; cover: string; resolve: () => void } | null;
const colorSubs = new Set<(s: ColorState) => void>();
export function pickCrateColor(genre: string, cover?: string): Promise<void> {
  if (!colorSubs.size) return Promise.resolve();
  return new Promise((resolve) => colorSubs.forEach((f) => f({ genre, cover: cover ?? genre, resolve })));
}

// Rendered once in the app; shows the genre box when something asks for it.
export function GenrePickHost() {
  const [s, setS] = useState<PickState>(null);
  const [c, setC] = useState<ColorState>(null);
  useEffect(() => { pickSubs.add(setS); return () => { pickSubs.delete(setS); }; }, []);
  useEffect(() => { colorSubs.add(setC); return () => { colorSubs.delete(setC); }; }, []);
  if (c) return <ColorBox key={c.genre} c={c} done={() => { c.resolve(); setC(null); }} />;
  if (!s) return null;
  return <GenreBox key={`${s.title}|${s.current}`} s={s} done={(g) => { s.resolve(g); setS(null); }} />;
}

// A row of colour swatches; "Its own" goes back to the genre's built-in colour.
function Swatches({ genre, value, onPick }: { genre: string; value: string | null; onPick: (hex: string | null) => void }) {
  const own = builtInColor(genre);
  return (
    <div className="swatches" role="radiogroup" aria-label={`Crate colour for ${genre}`}>
      <button type="button" role="radio" aria-checked={!value} className={`swatch swatch--own${!value ? " swatch--on" : ""}`}
        style={{ background: own }} title={`${genre}'s own colour`} aria-label="Its own colour" onClick={() => onPick(null)} />
      {CRATE_COLORS.filter((hex) => hex.toLowerCase() !== own.toLowerCase()).map((hex) => (
        <button key={hex} type="button" role="radio" aria-checked={value === hex}
          className={`swatch${value === hex ? " swatch--on" : ""}`} style={{ background: hex }}
          aria-label={`Colour ${hex}`} onClick={() => onPick(hex)} />
      ))}
    </div>
  );
}

function ColorBox({ c, done }: { c: NonNullable<ColorState>; done: () => void }) {
  const [value, setValue] = useState<string | null>(pickedColor(c.genre));
  const [leaving, leave] = useLeave(done);
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); leave(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const save = () => { if (value !== pickedColor(c.genre)) setGenreColor(c.genre, value); leave(); };
  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={() => leave()}>
      <div ref={ref} className="wnew confirm gpick" role="dialog" aria-modal="true" aria-labelledby="gcolor-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="gpick__body">
          <div className="gpick__art" aria-hidden>
            <Cover name={c.cover} genre={null} size={92} colour={value ?? builtInColor(c.genre)} />
          </div>
          <div className="gpick__main">
            <div className="eyebrow">Crate colour</div>
            <h2 id="gcolor-title" className="col-trunc" title={c.genre}>{c.genre}</h2>
            <p className="gpick__now">Every {c.genre} stripe, cover and crate takes this colour, on this computer.</p>
            <Swatches genre={c.genre} value={value} onPick={setValue} />
          </div>
        </div>
        <div className="confirm__foot gpick__foot">
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={() => leave()}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={value === pickedColor(c.genre)} onClick={save}>Save colour</button>
        </div>
      </div>
    </div>
  );
}

function GenreBox({ s, done: close }: { s: NonNullable<PickState>; done: (g: GenrePickResult) => void }) {
  const [leaving, done] = useLeave(close);
  const yours = [...new Set((s.yours ?? []).filter((g) => g && !GENRES.includes(g)))].sort((a, b) => a.localeCompare(b));
  const known = !s.current || GENRES.includes(s.current) || yours.includes(s.current);
  const [choice, setChoice] = useState<string>(s.current ? (known ? s.current : OTHER) : "");
  const [own, setOwn] = useState<string>(known ? "" : s.current ?? "");
  const ref = useRef<HTMLDivElement | null>(null);
  const picked = choice === OTHER ? own.trim() : choice;
  const changed = picked !== (s.current ?? "") || (!s.setByYou && !!picked);
  // the crate colour of the genre picked, changed in the same box
  const [colour, setColour] = useState<Record<string, string | null>>({});
  const colourFor = (g: string) => (g in colour ? colour[g] : pickedColor(g));
  const colourChanged = !!picked && colourFor(picked) !== pickedColor(picked);
  useDialogFocus(ref);

  useEffect(() => {
    ref.current?.querySelector<HTMLSelectElement>("select")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(undefined); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const save = () => {
    if (!picked) return;
    if (colourChanged) setGenreColor(picked.slice(0, 40), colourFor(picked));
    done(changed ? picked.slice(0, 40) : undefined);
  };
  const many = (s.count ?? 1) > 1;
  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={() => done(undefined)}>
      <div ref={ref} className="wnew confirm gpick" role="dialog" aria-modal="true" aria-labelledby="gpick-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); save(); } }}>
        <div className="gpick__body">
          <div className="gpick__art" aria-hidden>
            <Cover name={s.cover} genre={picked || s.current} size={92}
              colour={picked && colourFor(picked) !== pickedColor(picked) ? colourFor(picked) ?? builtInColor(picked) : undefined} />
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
                {GENRE_GROUPS.map((grp) => (
                  <optgroup key={grp.label} label={grp.label}>
                    {grp.genres.map(([g]) => <option key={g} value={g}>{g}</option>)}
                  </optgroup>
                ))}
                <option value={OTHER}>Something else…</option>
              </select>
            </label>
            {choice === OTHER && (
              <input type="text" className="gpick__own" value={own} maxLength={40} autoFocus
                placeholder="Type the genre, e.g. Afrobeats" onChange={(e) => setOwn(e.target.value)} />
            )}
            {picked && (
              <div className="gpick__colour">
                <span className="gpick__colourlbl">Crate colour for {picked}</span>
                <Swatches genre={picked} value={colourFor(picked)} onPick={(hex) => setColour((c) => ({ ...c, [picked]: hex }))} />
              </div>
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
          <button type="button" className="btn btn--primary" disabled={!picked || (!changed && !colourChanged)} onClick={save}>{changed || !colourChanged ? "Save genre" : "Save colour"}</button>
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
      title={label} aria-label={`${genre || "Set genre"}${genre ? (setByYou ? " set by you" : " guessed") : ""}. ${label}`} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <span className="genrechip__dot" style={{ background: genreColor(genre) }} />
      <span className={setByYou || !genre ? "" : "genre-guess"}>{genre || "Set genre"}</span>
      {genre && <span className="genrechip__how">{setByYou ? "set by you" : "guessed"}</span>}
      <svg className="genrechip__pen" viewBox="0 0 16 16" width="11" height="11" aria-hidden>
        <path d="M10.5 2.5l3 3L6 13H3v-3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
