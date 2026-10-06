import { useMemo } from "react";
import type { Project } from "./types";
import { genreOf, tintOf } from "./types";
import { moreLikeThis } from "./similar";
import { useSoundPrints } from "./listen";
import { fmtCount } from "../../format";
import { Cover } from "../../components/Cover";
import { Icon } from "../../components/Icon";
import { PlayButton } from "../../components/Player";

// The records in your library closest to `seed`: a ranked list with the reasons in
// Crate, a row of covers with the match in Sleeve. Clicking one flips Dig to it.
export function MoreLikeThis({ seed, all, look, onPick, onClose }: {
  seed: Project; all: Project[]; look: "crate" | "sleeve";
  onPick: (p: Project) => void; onClose: () => void;
}) {
  const paths = useMemo(() => {
    const rest = all.filter((p) => p.latest && p.id !== seed.id).map((p) => p.latest!.path);
    return seed.latest ? [seed.latest.path, ...rest] : [];
  }, [all, seed]);
  const { prints, done, total } = useSoundPrints(paths, true);
  const matches = useMemo(() => moreLikeThis(seed, all, prints), [seed, all, prints]);
  const listening = done < total;

  const head = (
    <div className="mlt__head">
      <b>More like {seed.name}</b>
      <span className="faint" role="status" aria-live="polite">
        {!seed.latest ? "By tempo and genre. Export a song from this project to match by sound too."
          : listening ? `Listening to your songs, ${fmtCount(done)} of ${fmtCount(total)}. The list sharpens as it goes.`
          : "By tempo, genre, key and how each song sounds."}
      </span>
      <span className="grow" />
      <button className="iconbtn" aria-label="Close More like this" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
  );

  if (!matches.length) {
    return <div className={`mlt mlt--${look}`}>{head}<p className="faint mlt__none">Nothing close yet. Records need a tempo or an exported song to compare.</p></div>;
  }

  if (look === "sleeve") {
    return (
      <div className="mlt mlt--sleeve">
        {head}
        <div className="mlt__strip" role="list">
          {matches.map((m) => {
            const g = genreOf(m.project);
            return (
              <button key={m.project.id} role="listitem" className="mlt__card" onClick={() => onPick(m.project)}
                aria-label={`${m.project.name}, ${m.score}% match. ${m.why.join(", ")}`}>
                <span className="mlt__art">
                  <Cover name={m.project.name} genre={g} size={150} />
                  <span className="mlt__score">{m.score}%</span>
                </span>
                <span className="mlt__name">{m.project.name}</span>
                <span className="faint mlt__facts">{[g, m.project.bpm ? `${Math.round(m.project.bpm)} BPM` : null].filter(Boolean).join(" · ")}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mlt mlt--crate">
      {head}
      <div className="table table--crate mlt__table">
        <div className="row cols cols-head mlt__cols">
          <span /><span className="col-num">#</span><span /><span>Project</span><span>Genre</span>
          <span className="col-num">BPM</span><span>Match</span><span>Why it matches</span>
        </div>
        {matches.map((m, i) => {
          const p = m.project, g = genreOf(p);
          return (
            <div key={p.id} className="row cols mlt__cols">
              <span className="stripe" style={{ background: tintOf(p) }} />
              <span className="col-num">{i + 1}</span>
              {p.latest
                ? <PlayButton path={p.latest.path} title={p.latest.name} meta={{ title: p.latest.name, project: p.name, genre: g }} size={28} />
                : <span />}
              <button className="mlt__open" onClick={() => onPick(p)}>{p.name}</button>
              <span className="mlt__genre">{g ?? "—"}</span>
              <span className="col-num">{p.bpm ? Math.round(p.bpm) : "—"}</span>
              <span className="mlt__match"><span className="mlt__bar"><i style={{ width: `${m.score}%` }} /></span><span className="col-num">{m.score}%</span></span>
              <span className="mlt__why">{m.why.slice(0, 2).map((w) => <span key={w} className="fact-chip">{w}</span>)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
