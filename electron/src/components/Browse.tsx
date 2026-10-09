import type { CSSProperties, ReactNode } from "react";
import { genreColor } from "../look";
import { Icon, type IconName } from "./Icon";

// Browse by Genre, then Year, then the projects or tracks themselves, like a record
// shop's racks (rekordbox calls it Column View). Crate shows three columns side by
// side; Sleeve shows the same two choices as rows of chips over the cover wall.
// Above the genres sit your favourites (pinned, rated): each narrows the other two
// columns too, so "rated House from 2025" is three clicks.
// Picking sets the page's own Genre and Year filters, so search, the other filters
// and smart crates all work with it. SHARED FILE: the same file lives in Backups and
// Uploader (electron/src/components/Browse.tsx); change both together.

export const NO_GENRE = "-";   // the Genre filter value for "No genre yet"
export const NO_YEAR = "-";    // the Year filter value for "No date" (an item whose year isn't known)

export interface Facet { value: string; label: string; n: number; colour?: string }

// Genres (most first) and years (newest first) with how many items each holds.
export function facets<T>(items: T[], genreOf: (t: T) => string | null | undefined, yearOf: (t: T) => string, genre: string): { genres: Facet[]; years: Facet[] } {
  const g = new Map<string, number>(), y = new Map<string, number>();
  let none = 0, noYear = 0;
  for (const it of items) {
    const name = (genreOf(it) || "").trim();
    if (name) g.set(name, (g.get(name) ?? 0) + 1); else none++;
    const inGenre = !genre || (genre === NO_GENRE ? !name : name === genre);
    const yr = yearOf(it);
    if (inGenre && yr) y.set(yr, (y.get(yr) ?? 0) + 1);
    else if (inGenre) noYear++;
  }
  const genres: Facet[] = [...g].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, n]) => ({ value, label: value, n, colour: genreColor(value) }));
  if (none) genres.push({ value: NO_GENRE, label: "No genre yet", n: none, colour: genreColor(null) });
  const years: Facet[] = [...y].sort((a, b) => b[0].localeCompare(a[0])).map(([value, n]) => ({ value, label: value, n }));
  if (noYear) years.push({ value: NO_YEAR, label: "No date", n: noYear });   // so the years add up to "All years"
  return { genres, years };
}

// One of your favourites to narrow by: "Pinned", "Rated".
export interface Mark { key: string; label: string; icon: IconName; n: number; on: boolean; onToggle: () => void; tone?: "pin" | "rate" }

function Opt({ on, onClick, stripe, children, label, n, cls = "" }: {
  on: boolean; onClick: () => void; stripe?: string; children: ReactNode; label: string; n: number; cls?: string;
}) {
  // A long genre ends in "…" and shows whole on hover.
  return (
    <button type="button" className={`browse__opt${on ? " browse__opt--on" : ""}${cls}`} aria-pressed={on} onClick={onClick} title={label}>
      {stripe && <span className="browse__stripe" style={{ background: stripe }} />}
      <span className="browse__name">{children}</span>
      <span className="browse__n">{n.toLocaleString()}</span>
      <Icon name="chevronRight" size={12} className="browse__go" />
    </button>
  );
}

function Column({ title, all, total, list, value, onPick, marks }: {
  title: string; all: string; total: number; list: Facet[]; value: string; onPick: (v: string) => void; marks?: Mark[];
}) {
  return (
    <div className="browse__col" role="group" aria-label={title}>
      <div className="browse__head">{title}</div>
      <div className="browse__list">
        {marks && marks.length > 0 && (
          <div className="browse__marks" role="group" aria-label="Favourites">
            <div className="browse__section">Favourites</div>
            {marks.map((m) => (
              <Opt key={m.key} on={m.on} n={m.n} label={m.label} onClick={m.onToggle} cls={` browse__opt--mark${m.tone ? ` browse__opt--${m.tone}` : ""}${!m.n && !m.on ? " browse__opt--none" : ""}`}>
                <Icon name={m.icon} size={13} className="browse__markicon" /><span className="browse__label">{m.label}</span>
              </Opt>
            ))}
          </div>
        )}
        <Opt on={!value} n={total} label={all} onClick={() => onPick("")}><span className="browse__label">{all}</span></Opt>
        {list.map((f) => (
          <Opt key={f.value} on={value === f.value} n={f.n} stripe={f.colour} label={f.label} onClick={() => onPick(value === f.value ? "" : f.value)}><span className="browse__label">{f.label}</span></Opt>
        ))}
      </div>
    </div>
  );
}

// Crate: Genre | Year | the items (drawn by the page, one row each).
export function ColumnBrowse({ genres, years, total, inGenre, genre, year, onGenre, onYear, yearTitle, noun, marks, cols, narrowCols, heads, children }: {
  genres: Facet[]; years: Facet[]; total: number; inGenre: number;
  genre: string; year: string; onGenre: (g: string) => void; onYear: (y: string) => void;
  yearTitle: string;      // "Year last saved", "Year posted"
  noun: string;           // the third column's title: "Projects", "Tracks"
  marks?: Mark[];         // favourites over the genres
  cols?: string;          // the item rows' grid columns, so the headings line up with them
  narrowCols?: string;    // the same in the narrow window
  heads?: ReactNode[];    // a heading per item column after the name ("Rating", "Backup")
  children: ReactNode;
}) {
  return (
    <div className="browse" style={cols ? { ["--browse-cols" as string]: cols, ["--browse-cols-narrow" as string]: narrowCols ?? cols } as CSSProperties : undefined}>
      <Column title="Genre" all="All genres" total={total} list={genres} value={genre} onPick={(g) => { onGenre(g); }} marks={marks} />
      <Column title={yearTitle} all="All years" total={inGenre} list={years} value={year} onPick={onYear} />
      <div className="browse__col browse__col--items" role="group" aria-label={noun}>
        <div className={`browse__head${heads ? " browse__head--items" : ""}`}>
          {heads ? <><span className="browse__headname" style={{ gridColumn: `1 / ${-(heads.length + 1)}` }}>{noun}</span>{heads.map((h, i) => <span key={i}>{h}</span>)}</> : noun}
        </div>
        <div className="browse__list">{children}</div>
      </div>
    </div>
  );
}

// An item row opens when clicked anywhere except its own controls (pin, rating).
// The row itself isn't a button (buttons can't hold buttons): its name is.
export function openFromRow(open: () => void) {
  return (e: { target: EventTarget | null }) => {
    if ((e.target as HTMLElement | null)?.closest?.("button, [role='slider'], input, a")) return;
    open();
  };
}

// Sleeve: the same two choices as rows of chips over the wall.
export function FacetChips({ genres, years, genre, year, onGenre, onYear, yearTitle }: {
  genres: Facet[]; years: Facet[]; genre: string; year: string;
  onGenre: (g: string) => void; onYear: (y: string) => void; yearTitle: string;
}) {
  const row = (label: string, list: Facet[], value: string, pick: (v: string) => void) => list.length > 1 && (
    <div className="facets__row" role="group" aria-label={label}>
      <span className="facets__label">{label}</span>
      <div className="facets__chips">
        {list.map((f) => (
          <button key={f.value} type="button" className={`facet${value === f.value ? " facet--on" : ""}`} aria-pressed={value === f.value}
            onClick={() => pick(value === f.value ? "" : f.value)}>
            {f.colour && <span className="facet__dot" style={{ background: f.colour }} />}
            {f.label}<span className="facet__n">{f.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="facets">
      {row("Genre", genres, genre, onGenre)}
      {row(yearTitle, years, year, onYear)}
    </div>
  );
}
