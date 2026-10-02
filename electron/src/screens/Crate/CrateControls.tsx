import type { GroupBy, CrateSort } from "./types";

export function CrateControls({ groupBy, setGroupBy, crateSort, setCrateSort, search, setSearch, onDigAll, reduceMotion, setReduceMotion }: {
  groupBy: GroupBy; setGroupBy: (g: GroupBy) => void;
  crateSort: CrateSort; setCrateSort: (s: CrateSort) => void;
  search: string; setSearch: (s: string) => void;
  onDigAll: () => void;
  reduceMotion: boolean; setReduceMotion: (v: boolean) => void;
}) {
  return (
    <div className="crate-controls">
      <span className="faint" style={{ fontSize: 12.5 }}>Crates by</span>
      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label="Group crates by">
        <option value="genre">Genre</option>
        <option value="daw">Music app</option>
        <option value="tempo">Tempo</option>
        <option value="recency">Recency</option>
      </select>
      <select value={crateSort} onChange={(e) => setCrateSort(e.target.value as CrateSort)} aria-label="Sort crates">
        <option value="count">Most records</option>
        <option value="name">Name</option>
        <option value="recent">Recently used</option>
      </select>
      <input className="crate-search grow" type="text" placeholder="Search projects…"
        value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search projects" />
      <label className="toolchk">
        <input type="checkbox" checked={reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} /> Less movement
      </label>
      <button className="btn btn--ghost btn--sm" onClick={onDigAll}>Dig through everything</button>
    </div>
  );
}
