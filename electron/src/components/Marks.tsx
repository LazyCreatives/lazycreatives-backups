import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { DENSITIES, GLYPHS, setGlyph, setRating, useRatings, type Density, type Glyph } from "../marks";

// The rating marks and the row-height switch (see marks.ts). SHARED FILE: the same
// file lives in Backups and Uploader (electron/src/components/Marks.tsx). Styles are
// in lazy-ui.css (.rating, .rowsize), in both looks.

const FILLED: Record<Glyph, IconName> = { flame: "flameFilled", heart: "heartFilled", disc: "discFilled", dot: "dotFilled" };

// Five marks; click one to rate up to it, click the same one again to clear.
// Arrow keys move the rating, 0 or Backspace clears it.
export function Rating({ id, name, size = 13, readOnly = false }: { id: string; name: string; size?: number; readOnly?: boolean }) {
  const { rating, glyph } = useRatings();
  const n = rating(id);
  const [hover, setHover] = useState(0);
  const shown = hover || n;
  const word = GLYPHS.find((g) => g.key === glyph)!.label.toLowerCase();
  const say = n ? `${name}: rated ${n} of 5` : `${name}: not rated`;
  if (readOnly) {
    return n ? (
      <span className={`rating rating--${glyph} rating--read`} title={`Rated ${n} of 5`} aria-label={say} role="img">
        {Array.from({ length: n }, (_, i) => <Icon key={i} name={FILLED[glyph]} size={size} />)}
      </span>
    ) : null;
  }
  return (
    <span className={`rating rating--${glyph}${n ? "" : " rating--none"}`} role="slider" tabIndex={0}
      aria-label={`Rating for ${name}, in ${word}`} aria-valuemin={0} aria-valuemax={5} aria-valuenow={n}
      aria-valuetext={n ? `${n} of 5` : "not rated"} title={n ? `Rated ${n} of 5. Click the last one again to clear` : "Rate it"}
      onClick={(e) => e.stopPropagation()} onMouseLeave={() => setHover(0)}
      onKeyDown={(e) => {
        const to = e.key === "ArrowRight" || e.key === "ArrowUp" ? n + 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? n - 1
          : /^[0-5]$/.test(e.key) ? Number(e.key) : e.key === "Backspace" || e.key === "Delete" ? 0 : -1;
        if (to < 0) return;
        e.preventDefault(); e.stopPropagation();
        setRating(id, Math.max(0, Math.min(5, to)));
      }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`rating__mark${i <= shown ? " rating__mark--on" : ""}${hover && i <= hover ? " rating__mark--try" : ""}`}
          onMouseEnter={() => setHover(i)}
          onClick={() => { setRating(id, i === n ? 0 : i); setHover(0); }}>
          <Icon name={i <= shown ? FILLED[glyph] : glyph} size={size} />
        </span>
      ))}
    </span>
  );
}

// Right-click menu items for rating something (or several things) from a menu.
export function ratingMenu(ids: string[], current: number) {
  return [
    ...[5, 4, 3, 2, 1].map((n) => ({ label: `Rate ${n} of 5${current === n ? "  (now)" : ""}`, onClick: () => setRating(ids, n), disabled: current === n })),
    ...(current ? [{ label: "Clear rating", onClick: () => setRating(ids, 0) }] : []),
  ];
}

// Which mark ratings are drawn with, for Settings.
export function GlyphPicker() {
  const { glyph } = useRatings();
  return (
    <div className="seg glyphpick" role="radiogroup" aria-label="Rating mark">
      {GLYPHS.map((g) => (
        <button key={g.key} type="button" role="radio" aria-checked={glyph === g.key}
          className={`seg__opt glyphopt${glyph === g.key ? " seg__opt--on" : ""}`} onClick={() => setGlyph(g.key)}>
          <Icon name={FILLED[g.key]} size={12} />{g.label}
        </button>
      ))}
    </div>
  );
}

// Three row heights for a Crate list, next to its filters.
export function RowSize({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  return (
    <div className="rowsize seg" role="radiogroup" aria-label="Row height">
      {DENSITIES.map((d) => (
        <button key={d.key} type="button" role="radio" aria-checked={value === d.key} title={`${d.label} rows`}
          aria-label={`${d.label} rows`} className={`seg__opt rowsize__opt rowsize__opt--${d.key}${value === d.key ? " seg__opt--on" : ""}`}
          onClick={() => onChange(d.key)}>
          <span className="rowsize__ico" aria-hidden><i /><i /><i /></span>
        </button>
      ))}
    </div>
  );
}
