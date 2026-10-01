import type { GroupBy, CrateSort } from "./types";

export function CrateControls({ groupBy, setGroupBy, crateSort, setCrateSort, search, setSearch, onDigAll }: {
  groupBy: GroupBy; setGroupBy: (g: GroupBy) => void;
  crateSort: CrateSort; setCrateSort: (s: CrateSort) => void;
  search: string; setSearch: (s: string) => void;
  onDigAll: () => void;
}) {
  return (
    <div className="crate-controls">
      <span className="sub" style={{ margin: 0, fontSize: 12 }}>Crates by</span>
      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label="Group crates by">
        <option value="genre">Genre</option>
        <option value="daw">DAW</option>
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
      <button className="btn btn--ghost btn--sm" onClick={onDigAll}>Dig all records</button>
    </div>
  );
}
