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
    ref.current?.querySelector<HTMLInputElement>(".gpick__find input")?.focus();
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
            <GenreFind yours={yours} value={picked}
              onPick={(g) => { setChoice(g); setOwn(""); }} onOwn={(g) => { setChoice(OTHER); setOwn(g); }} />
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

// Type to find a genre among the built-in ones (in their groups) and your own. The
// list stays open under the box: arrows move, Enter picks, and a name that isn't
// listed can be used as it is.
const fold = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^a-z0-9&]+/g, "");
function GenreFind({ yours, value, onPick, onOwn }: {
  yours: string[]; value: string; onPick: (g: string) => void; onOwn: (g: string) => void;
}) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(-1);
  const list = useRef<HTMLDivElement | null>(null);
  const all = [...(yours.length ? [{ label: "Your genres", genres: yours }] : []),
    ...GENRE_GROUPS.map((g) => ({ label: g.label, genres: g.genres.map(([n]) => n) }))];
  const k = fold(q);
  // a group whose name matches shows whole ("dnb" finds the Drum & bass group too)
  const groups = !k ? all : all.map((g) => ({ ...g, genres: fold(g.label).includes(k) ? g.genres : g.genres.filter((n) => fold(n).includes(k)) }))
    .filter((g) => g.genres.length);
  const flat = groups.flatMap((g) => g.genres);
  const own = q.trim() && !flat.some((n) => fold(n) === k) ? q.trim().slice(0, 40) : "";
  const count = flat.length + (own ? 1 : 0);
  // the one picked shows in view when the box opens
  useEffect(() => { list.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "center" }); }, []);
  useEffect(() => { list.current?.querySelector<HTMLElement>(".gpick__opt--at")?.scrollIntoView({ block: "nearest" }); }, [at]);
  const choose = (i: number) => { if (i < flat.length) onPick(flat[i]); else if (own) onOwn(own); setQ(""); setAt(-1); };
  const onKey = (e: { key: string; preventDefault(): void; stopPropagation(): void }) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (count) setAt((a) => (a + (e.key === "ArrowDown" ? 1 : count - 1) + (a < 0 && e.key === "ArrowUp" ? 1 : 0)) % count);
    } else if (e.key === "Enter" && q.trim()) {
      // Enter picks what's typed (the first match, or the one moved to); a second Enter saves
      e.preventDefault(); e.stopPropagation();
      if (count) choose(Math.max(0, at));
    }
  };
  let n = -1;
  return (
    <div className="gpick__finder">
      <label className="gpick__find">
        <span className="gpick__swatch" style={{ background: genreColor(value || null) }} />
        <input type="text" value={q} role="combobox" aria-expanded="true" aria-controls="gpick-list" aria-autocomplete="list"
          aria-activedescendant={at >= 0 ? `gpick-opt-${at}` : undefined} aria-label="Find a genre"
          placeholder={value ? `${value} · type to find another` : `Type to find a genre (${GENRES.length} to pick from)`}
          onChange={(e) => { setQ(e.target.value); setAt(e.target.value.trim() ? 0 : -1); }} onKeyDown={onKey} />
      </label>
      <div ref={list} id="gpick-list" className="gpick__list" role="listbox" aria-label="Genres">
        {groups.map((g) => (
          <div key={g.label} role="group" aria-labelledby={`gpick-g-${fold(g.label)}`}>
            <div id={`gpick-g-${fold(g.label)}`} className="gpick__head">{g.label}</div>
            {g.genres.map((name) => {
              const i = ++n;
              return (
                <div key={name} id={`gpick-opt-${i}`} role="option" aria-selected={name === value}
                  className={`gpick__opt${i === at ? " gpick__opt--at" : ""}${name === value ? " gpick__opt--on" : ""}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
                  <span className="gpick__dot" style={{ background: genreColor(name) }} />{name}
                </div>
              );
            })}
          </div>
        ))}
        {own && (
          <div id={`gpick-opt-${flat.length}`} role="option" aria-selected={false}
            className={`gpick__opt gpick__opt--own${at === flat.length ? " gpick__opt--at" : ""}`}
            onMouseDown={(e) => e.preventDefault()} onClick={() => choose(flat.length)}>
            <span className="gpick__dot" style={{ background: genreColor(own) }} />Use “{own}”
          </div>
        )}
      </div>
      <span className="sr-only" role="status">{q.trim() ? `${count} ${count === 1 ? "match" : "matches"}` : ""}</span>
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
