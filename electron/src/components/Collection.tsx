import { useLook } from "../look";

// "Your collection": the whole library at a glance, at the bottom of Home. Crate
// shows it as a spec sheet (a ruled row of figures, then bar lists you can click);
// Sleeve as the liner notes on the back of a record. Each app works out its own
// figures. SHARED FILE: the same file lives in Backups and Uploader
// (electron/src/components/Collection.tsx); change both together.

export interface CollectionRow { label: string; n: number; colour?: string; onClick?: () => void }
export interface CollectionData {
  intro: string;                                            // one sentence for the liner notes
  figures: { label: string; value: string; note?: string }[];
  lists: { title: string; rows: CollectionRow[] }[];
}

const TOP = 8;

export function Collection({ data }: { data: CollectionData }) {
  const [look] = useLook();
  const lists = data.lists.filter((l) => l.rows.length > 0);
  if (look === "sleeve") return (
    <section className="section liner" aria-labelledby="liner-h">
      <div className="liner__sheet">
        <h2 id="liner-h" className="liner__title">Liner notes</h2>
        <p className="liner__intro">{data.intro}</p>
        <dl className="liner__figures">
          {data.figures.map((f) => (
            <div key={f.label} className="liner__fig"><dt>{f.label}</dt><dd>{f.value}{f.note && <small>{f.note}</small>}</dd></div>
          ))}
        </dl>
        <div className="liner__cols">
          {lists.map((l) => (
            <div key={l.title} className="liner__col">
              <h3>{l.title}</h3>
              <ol>
                {l.rows.slice(0, TOP).map((r) => (
                  <li key={r.label}>
                    {r.onClick
                      ? <button type="button" className="liner__row" onClick={r.onClick}><span>{r.label}</span><i aria-hidden /><b>{r.n}</b></button>
                      : <span className="liner__row"><span>{r.label}</span><i aria-hidden /><b>{r.n}</b></span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
  return (
    <section className="section coll" aria-labelledby="coll-h">
      <div className="section__head"><h2 id="coll-h">Your collection</h2></div>
      <dl className="coll__figures">
        {data.figures.map((f) => (
          <div key={f.label} className="coll__fig"><dt>{f.label}</dt><dd>{f.value}</dd>{f.note && <span className="coll__note">{f.note}</span>}</div>
        ))}
      </dl>
      <div className="coll__lists">
        {lists.map((l) => {
          const max = Math.max(1, ...l.rows.map((r) => r.n));
          return (
            <div key={l.title} className="coll__list">
              <h3>{l.title}</h3>
              {l.rows.slice(0, TOP).map((r) => {
                const inner = <>
                  <span className="coll__label">{r.label}</span>
                  <span className="coll__bar"><i style={{ width: `${(r.n / max) * 100}%`, background: r.colour }} /></span>
                  <b>{r.n}</b>
                </>;
                return r.onClick
                  ? <button key={r.label} type="button" className="coll__row" onClick={r.onClick} title={`Show ${r.label}`}>{inner}</button>
                  : <div key={r.label} className="coll__row">{inner}</div>;
              })}
              {l.rows.length > TOP && <div className="coll__more">and {l.rows.length - TOP} more</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Count things into rows, most first ("House 34, Techno 20…").
export function tally<T>(items: T[], keyOf: (t: T) => string | null | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) { const k = keyOf(it); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
