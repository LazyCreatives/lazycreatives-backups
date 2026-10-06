import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useDialogFocus } from "./a11y";
import { Cover } from "./Cover";
import { toastWarn, useLeave } from "./Desktop";
import {
  addPictureFromFile, changeCovers, coverSource, resolveCover, useCovers,
  type CoverArt, type CoverChoice, type CoverPic, type CoverStyle, type CoverUse,
} from "../coverArt";

// Change one project's (or one upload's) cover: the default from Settings, the drawn
// cover, any saved picture, or a new one; as a background (in one of three styles) or
// the full cover; drag the big cover to move the square that is cut from the picture.
// SHARED FILE: the same file lives in Backups and Uploader; change both together.
// Styles are in lazy-ui.css (.cpick), in both looks.

export type CoverPickOpts = { title: string; name: string; genre?: string | null; note?: string };
type PickState = (CoverPickOpts & { resolve: (saved: boolean) => void }) | null;
const subs = new Set<(s: PickState) => void>();

// Opens the box; resolves true once a change is saved.
export function pickCover(opts: CoverPickOpts): Promise<boolean> {
  if (!subs.size) return Promise.resolve(false);
  return new Promise((resolve) => subs.forEach((f) => f({ ...opts, resolve })));
}

export function CoverPickHost() {
  const [s, setS] = useState<PickState>(null);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  if (!s) return null;
  return <CoverBox key={s.name} s={s} done={(saved) => { s.resolve(saved); setS(null); }} />;
}

export const STYLE_NAMES: [CoverStyle, string][] = [["ink", "Ink print"], ["photo", "Photo"], ["strip", "Label strip"]];
export const USE_NAMES: [CoverUse, string][] = [["background", "Background"], ["full", "Full cover"]];

const DEFAULT = "__default__", DRAWN = "__drawn__";

function CoverBox({ s, done: close }: { s: NonNullable<PickState>; done: (saved: boolean) => void }) {
  const [leaving, done] = useLeave(close);
  const st = useCovers();
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  const was = st.projects[s.name];
  const [pick, setPick] = useState<string>(was ? (was.pic ?? DRAWN) : DEFAULT);
  const [use, setUse] = useState<CoverUse | null>(was?.use ?? null);
  const [style, setStyle] = useState<CoverStyle | null>(was?.style ?? null);
  const [fx, setFx] = useState(was?.fx ?? 0.5);
  const [fy, setFy] = useState(was?.fy ?? 0.5);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // what this cover is without a pick of its own here (in Uploader: a Backups pick, if any)
  const { [s.name]: _own, ...others } = st.projects;
  const dfltArt = resolveCover({ ...st, projects: others }, s.name, s.genre);
  const pic: CoverPic | undefined = st.pictures.find((p) => p.id === pick);
  const src = coverSource();
  const artFor = (p: CoverPic | undefined, u?: CoverUse | null, sty?: CoverStyle | null, x = 0.5, y = 0.5): CoverArt | null =>
    p ? { src: src ? src.src(p.url) : p.url, use: u || p.use, style: sty || st.style, w: p.w || 1, h: p.h || 1, fx: x, fy: y, pic: p.id } : null;
  const shown = pick === DRAWN ? null : pick === DEFAULT ? dfltArt : artFor(pic, use, style, fx, fy);
  const own = pick !== DEFAULT && pick !== DRAWN;
  const effUse = shown?.use ?? "background";

  // drag the big cover to move the cut square (only where the picture is wider or taller)
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!own || !shown) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, fx, fy };
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !shown) return;
    const box = e.currentTarget.getBoundingClientRect();
    const k = Math.max(1 / shown.w, 1 / shown.h);  // picture px per box side
    const spareX = shown.w * k - 1, spareY = shown.h * k - 1;  // overhang, in box widths
    if (spareX > 0.001) setFx(Math.min(1, Math.max(0, d.fx - (e.clientX - d.x) / box.width / spareX)));
    if (spareY > 0.001) setFy(Math.min(1, Math.max(0, d.fy - (e.clientY - d.y) / box.height / spareY)));
  };
  const onUp = () => { drag.current = null; };

  async function addNew() {
    try {
      const id = await addPictureFromFile(use ?? "background");
      if (id) { setPick(id); setFx(0.5); setFy(0.5); }
    } catch (e) { toastWarn(String((e as Error).message)); }
  }

  async function save() {
    setBusy(true);
    const choice: CoverChoice | null = pick === DEFAULT ? null
      : pick === DRAWN ? { pic: null }
      : { pic: pick, use, style, fx, fy };
    try {
      await changeCovers((x) => x.choose(s.name, choice));
      done(true);
    } catch (e) {
      toastWarn(`The cover wasn't saved: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  // the default and the drawn cover show as covers; your pictures as themselves
  const tile = (key: string, label: string, art: CoverArt | null, raw?: string) => (
    <button key={key} type="button" role="radio" aria-checked={pick === key} title={label}
      className={`cpick__opt${pick === key ? " cpick__opt--on" : ""}`}
      onClick={() => { if (key !== pick) { setPick(key); setFx(0.5); setFy(0.5); } }}>
      {raw ? <img className="cpick__raw" src={raw} alt="" />
        : <Cover name={s.name} genre={s.genre} size={64} label={false} art={art} />}
      <span className="cpick__optname">{label}</span>
    </button>
  );

  return (
    <div className="wnew__scrim" data-leaving={leaving || undefined} onClick={() => done(false)}>
      <div ref={ref} className="wnew confirm cpick" role="dialog" aria-modal="true" aria-labelledby="cpick-title"
        onClick={(e) => e.stopPropagation()}>
        <div className="cpick__body">
          <div className={`cpick__art${own && shown ? " cpick__art--drag" : ""}`}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            title={own && shown ? "Drag to move the picture" : undefined}>
            <Cover name={s.name} genre={s.genre} size={196} art={shown} />
          </div>
          <div className="cpick__main">
            <div className="eyebrow">Cover</div>
            <h2 id="cpick-title" className="col-trunc" title={s.title}>{s.title}</h2>
            <div className="cpick__opts" role="radiogroup" aria-label="Cover">
              {tile(DEFAULT, "Default", dfltArt)}
              {tile(DRAWN, "Drawn", null)}
              {st.pictures.map((p) => tile(p.id, p.name, null, src ? src.src(p.url) : p.url))}
              <button type="button" className="cpick__opt cpick__opt--add" onClick={addNew}>
                <span className="cpick__plus" aria-hidden>+</span>
                <span className="cpick__optname">Choose a picture…</span>
              </button>
            </div>
            {own && (
              <div className="cpick__how">
                <Seg label="Use as" value={effUse} items={USE_NAMES} onPick={(u) => setUse(u)} />
                {effUse === "background" &&
                  <Seg label="Style" value={shown?.style ?? st.style} items={STYLE_NAMES} onPick={(v) => setStyle(v)} />}
              </div>
            )}
            <p className="gpick__note">
              {own && shown ? "Drag the cover to move the picture. " : ""}
              {pick === DEFAULT ? "Follows Settings, Covers: change a default there and this cover follows. " : ""}
              {s.note ?? ""}
            </p>
          </div>
        </div>
        <div className="confirm__foot gpick__foot">
          <button type="button" className="btn btn--ghost confirm__cancel" onClick={() => done(false)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>Save cover</button>
        </div>
      </div>
    </div>
  );
}

// A row of choices in the app's segmented control, with a label beside it.
export function Seg<T extends string>({ label, value, items, onPick, hideLabel, small }: {
  label: string; value: T; items: [T, string][]; onPick: (v: T) => void; hideLabel?: boolean; small?: boolean;
}) {
  return (
    <div className="cseg">
      {!hideLabel && <span className="cseg__label">{label}</span>}
      <div className={`seg${small ? " seg--sm" : ""}`} role="radiogroup" aria-label={label}>
        {items.map(([v, name]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v}
            className={`seg__opt${value === v ? " seg__opt--on" : ""}`} onClick={() => onPick(v)}>{name}</button>
        ))}
      </div>
    </div>
  );
}
