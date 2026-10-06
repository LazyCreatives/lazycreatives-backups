import { useState } from "react";
import { GENRES } from "../look";
import { addPictureFromFile, changeCovers, coverSource, useCovers, type CoverPic, type CoverRule } from "../coverArt";
import { Cover } from "./Cover";
import { Icon } from "./Icon";
import { Seg, STYLE_NAMES, USE_NAMES } from "./CoverPick";
import { askConfirm, toastWarn } from "./Desktop";

// Settings, Covers: your saved pictures, what each is used as, which genres get it,
// the main picture (everything else), and the rules for defaults and the background
// style. Crate shows the pictures as rows; Sleeve as a shelf of tiles.
// SHARED FILE: the same file lives in Backups and Uploader; change both together.
// Styles are in lazy-ui.css (.covshelf), in both looks.

const RULES: [CoverRule, string][] = [["genre", "By genre"], ["mix", "Mix them up"], ["one", "One for everything"]];
const ruleHelp = (rule: CoverRule, what: string) => ({
  genre: `A ${what} gets a picture given to its genre, or else the main picture.`,
  mix: `Each ${what} keeps one of your given-out pictures, spread across them all.`,
  one: `Every ${what} gets the main picture.`,
}[rule]);
export function CoverShelf({ sample, sampleGenre, what = "project" }: {
  sample: string; sampleGenre?: string | null;  // a real name to preview covers with
  what?: string;  // "project" (Backups) or "upload" (Uploader)
}) {
  const st = useCovers();
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); } catch (e) { toastWarn(String((e as Error).message)); } finally { setBusy(false); }
  };
  const update = (id: string, p: Parameters<NonNullable<ReturnType<typeof coverSource>>["update"]>[1]) =>
    run(() => changeCovers((s) => s.update(id, p)));
  const remove = async (p: CoverPic) => {
    const used = Object.values(st.projects).filter((c) => c.pic === p.id).length;
    const ok = await askConfirm({
      title: `Remove ${p.name}?`,
      body: used ? `${used} ${what}${used === 1 ? "" : "s"} picked it; they go back to the default.` : "Covers using it go back to the default.",
      confirm: "Remove picture", danger: true,
    });
    if (ok) run(() => changeCovers((s) => s.remove(p.id)));
  };
  const count = (p: CoverPic) => Object.values(st.projects).filter((c) => c.pic === p.id).length;

  return (
    <div className="covshelf">
      <div className="covshelf__rules">
        <Seg label="Which default" value={st.rule} items={RULES}
          onPick={(rule) => run(() => changeCovers((s) => s.settings({ rule })))} />
        <Seg label="Background style" value={st.style} items={STYLE_NAMES}
          onPick={(style) => run(() => changeCovers((s) => s.settings({ style })))} />
      </div>
      <p className="covshelf__help">{ruleHelp(st.rule, what)} With no pictures here, every cover stays drawn.</p>

      {st.pictures.length > 0 && (
        <div className="covshelf__list" role="list">
          <div className="covshelf__head" aria-hidden>
            <span />
            <span>Picture</span><span>Used as</span><span>Given to</span><span>Picked for</span><span />
          </div>
          {st.pictures.map((p) => {
            const given = p.genres.length ? p.genres.join(", ") : p.main ? "Everything else" : "Only when picked";
            return (
              <div key={p.id} className="covshelf__item" role="listitem">
                <span className="covshelf__thumb">
                  {/* Crate: the picture itself; Sleeve: a cover made with it */}
                  <img className="covshelf__raw" src={coverSource()?.src(p.url) ?? p.url} alt="" />
                  <Cover name={sample} genre={sampleGenre} size={120} label={false}
                    art={{ src: coverSource()?.src(p.url) ?? p.url, use: p.use, style: st.style, w: p.w || 1, h: p.h || 1, fx: 0.5, fy: 0.5, pic: p.id }} />
                  {p.main && <span className="covshelf__main" title="Main picture">★<span className="covshelf__mainword"> Main</span></span>}
                </span>
                <input type="text" className="covshelf__name" defaultValue={p.name} maxLength={80} aria-label="Picture name"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) update(p.id, { name: v }); }} />
                <Seg label="Used as" hideLabel small value={p.use} items={USE_NAMES} onPick={(use) => update(p.id, { use })} />
                <span className="covshelf__given" title={given}>
                  {p.genres.map((g) => (
                    <button key={g} type="button" className="genrechip covshelf__chip" title={`Stop giving it to ${g}`}
                      onClick={() => update(p.id, { genres: p.genres.filter((x) => x !== g) })}>{g} ×</button>
                  ))}
                  {!p.genres.length && <span className="covshelf__muted">{given}</span>}
                  <select className="covshelf__add" value="" aria-label={`Give ${p.name} to a genre`}
                    onChange={(e) => { const g = e.target.value; if (g) update(p.id, { genres: [...p.genres, g] }); }}>
                    <option value="">+ Genre</option>
                    {GENRES.filter((g) => !p.genres.includes(g)).map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </span>
                <span className="covshelf__count" data-none={!count(p) || undefined}>{count(p) || "–"}</span>
                <span className="covshelf__acts">
                  {!p.main && <button type="button" className="linkbtn" disabled={busy}
                    onClick={() => update(p.id, { main: true })}>Make main</button>}
                  <button type="button" className="linkbtn covshelf__remove" disabled={busy} onClick={() => remove(p)}>Remove</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="covshelf__foot">
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
          onClick={() => run(() => addPictureFromFile("background"))}><Icon name="plus" size={14} />Add a picture…</button>
        <span className="covshelf__muted">JPG, PNG or WebP. The app keeps its own copy.</span>
      </div>
    </div>
  );
}
