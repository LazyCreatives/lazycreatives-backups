import type { ReactNode } from "react";
import { genreColor } from "../look";

// Browse by Genre, then Year, then the projects or tracks themselves, like a record
// shop's racks (rekordbox calls it Column View). Crate shows three columns side by
// side; Sleeve shows the same two choices as rows of chips over the cover wall.
// Picking sets the page's own Genre and Year filters, so search, the other filters
// and smart crates all work with it. SHARED FILE: the same file lives in Backups and
// Uploader (electron/src/components/Browse.tsx); change both together.

export const NO_GENRE = "-";   // the Genre filter value for "No genre yet"

export interface Facet { value: string; label: string; n: number; colour?: string }

// Genres (most first) and years (newest first) with how many items each holds.
export function facets<T>(items: T[], genreOf: (t: T) => string | null | undefined, yearOf: (t: T) => string, genre: string): { genres: Facet[]; years: Facet[] } {
  const g = new Map<string, number>(), y = new Map<string, number>();
  let none = 0;
  for (const it of items) {
    const name = (genreOf(it) || "").trim();
    if (name) g.set(name, (g.get(name) ?? 0) + 1); else none++;
    const inGenre = !genre || (genre === NO_GENRE ? !name : name === genre);
    const yr = yearOf(it);
    if (inGenre && yr) y.set(yr, (y.get(yr) ?? 0) + 1);
  }
  const genres: Facet[] = [...g].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, n]) => ({ value, label: value, n, colour: genreColor(value) }));
  if (none) genres.push({ value: NO_GENRE, label: "No genre yet", n: none, colour: genreColor(null) });
  const years: Facet[] = [...y].sort((a, b) => b[0].localeCompare(a[0])).map(([value, n]) => ({ value, label: value, n }));
  return { genres, years };
}

function Column({ title, all, total, list, value, onPick }: {
  title: string; all: string; total: number; list: Facet[]; value: string; onPick: (v: string) => void;
}) {
  return (
    <div className="browse__col" role="group" aria-label={title}>
      <div className="browse__head">{title}</div>
      <div className="browse__list">
        <button type="button" className={`browse__opt${!value ? " browse__opt--on" : ""}`} aria-pressed={!value} onClick={() => onPick("")}>
          <span className="browse__name">{all}</span><span className="browse__n">{total}</span>
        </button>
        {list.map((f) => (
          <button key={f.value} type="button" className={`browse__opt${value === f.value ? " browse__opt--on" : ""}`}
            aria-pressed={value === f.value} onClick={() => onPick(value === f.value ? "" : f.value)}>
            {f.colour && <span className="browse__stripe" style={{ background: f.colour }} />}
            <span className="browse__name">{f.label}</span><span className="browse__n">{f.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Crate: Genre | Year | the items (drawn by the page, one row each).
export function ColumnBrowse({ genres, years, total, inGenre, genre, year, onGenre, onYear, yearTitle, noun, children }: {
  genres: Facet[]; years: Facet[]; total: number; inGenre: number;
  genre: string; year: string; onGenre: (g: string) => void; onYear: (y: string) => void;
  yearTitle: string;      // "Year last saved", "Year posted"
  noun: string;           // the third column's title: "Projects", "Tracks"
  children: ReactNode;
}) {
  return (
    <div className="browse">
      <Column title="Genre" all="All genres" total={total} list={genres} value={genre} onPick={(g) => { onGenre(g); }} />
      <Column title={yearTitle} all="All years" total={inGenre} list={years} value={year} onPick={onYear} />
      <div className="browse__col browse__col--items" role="group" aria-label={noun}>
        <div className="browse__head">{noun}</div>
        <div className="browse__list">{children}</div>
      </div>
    </div>
  );
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
