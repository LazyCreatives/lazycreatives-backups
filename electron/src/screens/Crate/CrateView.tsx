import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DUR } from "./motion";
import type { GroupBy, CrateSort, DigSort, CrateGroup, Project } from "./types";
import { toProjectFromLibrary, SLOTH_BLUE } from "./types";
import type { LibraryItem } from "../../types";
import { NO_FILTERS, applyFilters, type LibFilters } from "../../libraryFilter";
import { useSmartCrates } from "../../smart";
import { useFolders } from "../../projectFolders";
import { genreColor, genreColorsVersion } from "../../look";
import { ratingOf, useRatings } from "../../marks";
import { lastLibrary, makeApi } from "../../api";
import { fmtCount } from "../../format";
import { Icon } from "../../components/Icon";
import { useCrates } from "./hooks/useCrates";
import { CrateControls } from "./CrateControls";
import { CrateShelf } from "./CrateShelf";
import { CrateDig } from "./CrateDig";
import { EmptyCrate } from "./EmptyCrate";
import "./crate.css";

const api = makeApi();

// Folder crates shown before the genre crates; the rest are behind "All folders…".
const FOLDER_SHELF = 8;

// Top-level crate-digger state machine (shelf ↔ dig). Sources your WHOLE scanned
// collection (/api/library) so everything you've scanned is diggable, enriched with
// genre/BPM from the backed-up set (/api/projects). Opening a record calls
// onOpenProject(name) so the host can show that project's backups.
// Which crate is open lives in the app's back/forward history (openKey), and the
// shelf settings and the record on deck are kept while the app is open, so coming
// back from a project lands on the same record.
const kept = {
  groupBy: "genre" as GroupBy, crateSort: "count" as CrateSort, search: "",
  active: 0, digSort: "recent" as DigSort, verifiedOnly: false,
};
function useKept<K extends keyof typeof kept>(k: K) {
  const [v, setV] = useState<(typeof kept)[K]>(kept[k]);
  const set = (n: (typeof kept)[K] | ((cur: (typeof kept)[K]) => (typeof kept)[K])) =>
    setV((cur) => (kept[k] = typeof n === "function" ? (n as (c: (typeof kept)[K]) => (typeof kept)[K])(cur) : n));
  return [v, set] as const;
}

export function CrateView({ openKey, onOpenKey, onCloseKey, onOpenProject }: {
  openKey: string | null; onOpenKey: (key: string) => void; onCloseKey: () => void;
  onOpenProject?: (name: string) => void;
}) {
  const osReduce = useReducedMotion();
  const [manualReduce, setManualReduce] = useState(false);
  const reduce = !!osReduce || manualReduce;

  const kept = lastLibrary();  // the last load, drawn at once while a fresh copy loads
  const [projects, setProjects] = useState<Project[]>(() => kept?.projects.map(toProjectFromLibrary) ?? []);
  const [items, setItems] = useState<LibraryItem[]>(() => kept?.projects ?? []);
  const [loading, setLoading] = useState(kept === null);
  useEffect(() => {
    let alive = true;
    api.library()
      .then((lib) => { if (alive) { setItems(lib.projects); setProjects(lib.projects.map(toProjectFromLibrary)); } })
      .catch(() => { /* leave empty */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const [groupBy, setGroupBy] = useKept("groupBy");
  const [crateSort, setCrateSort] = useKept("crateSort");
  const [search, setSearch] = useKept("search");
  const crates = useCrates(projects, groupBy, crateSort, search);
  // Smart crates saved in the Library: what fits each one right now
  const saved = useSmartCrates<LibFilters>("library");
  useRatings();
  const rated = items.map((i) => ratingOf(i.project_id)).join();
  const colours = genreColorsVersion();
  const smart: CrateGroup[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return saved.map((c) => {
      const f = { ...NO_FILTERS, ...c.filters };
      const list = applyFilters(items, f).map(toProjectFromLibrary).filter((p) => !q || p.name.toLowerCase().includes(q));
      const accent = f.genre && f.genre !== "-" ? genreColor(f.genre) : SLOTH_BLUE;
      return { key: `smart:${c.id}`, label: c.name, accent, projects: list, count: list.length };
    });
  }, [saved, items, search, rated, colours]);

  // Your folders (the app's own, made in the Library): one crate each
  const folders = useFolders();
  const everyFolder: CrateGroup[] = useMemo(() => {
    // looked up by id: with thousands of folders, sifting every project for each was slow
    const at = new Map(items.map((i, n) => [i.project_id, n]));
    return folders.map((f) => {
      const list = f.project_ids.flatMap((id) => at.get(id) ?? []).sort((a, b) => a - b).map((n) => toProjectFromLibrary(items[n]));
      return { key: `folder:${f.id}`, label: f.name, accent: SLOTH_BLUE, projects: list, count: list.length };
    }).filter((c) => c.count > 0);  // an empty folder has nothing to dig through
  }, [folders, items]);
  // on the shelf, the project search narrows each folder too
  const folderCrates: CrateGroup[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return everyFolder;
    return everyFolder.map((c) => {
      const list = c.projects.filter((p) => p.name.toLowerCase().includes(q));
      return { ...c, projects: list, count: list.length };
    }).filter((c) => c.count > 0);
  }, [everyFolder, search]);

  const [active, setActive] = useKept("active");
  const [digSort, setDigSort] = useKept("digSort");
  const [verifiedOnly, setVerifiedOnly] = useKept("verifiedOnly");
  const triggerRef = useRef<HTMLElement | null>(null);

  const openGroup: CrateGroup | null =
    openKey === "__all__"
      ? { key: "__all__", label: "All records", accent: SLOTH_BLUE, projects, count: projects.length }
      : crates.find((c) => c.key === openKey) ?? smart.find((c) => c.key === openKey)
        ?? folderCrates.find((c) => c.key === openKey) ?? everyFolder.find((c) => c.key === openKey) ?? null;
  const level: "shelf" | "folders" | "dig" = openGroup ? "dig" : openKey === "__folders__" ? "folders" : "shelf";
  const [folderSearch, setFolderSearch] = useState("");
  const allFolders = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    return q ? everyFolder.filter((c) => c.label.toLowerCase().includes(q)) : everyFolder;
  }, [everyFolder, folderSearch]);
  const folderWord = (n: number) => `${fmtCount(n)} folder${n === 1 ? "" : "s"}`;

  // a crate opened from "All folders…" goes back there, not to the shelf
  const fromFolders = useRef(false);
  function open(key: string) {
    triggerRef.current = document.activeElement as HTMLElement;
    fromFolders.current = openKey === "__folders__" && key !== "__folders__";
    setActive(0);
    onOpenKey(key);
  }
  function back() {
    if (level === "dig" && fromFolders.current) { fromFolders.current = false; onOpenKey("__folders__"); return; }
    if (level === "folders") setFolderSearch("");
    onCloseKey();
    const t = triggerRef.current;
    requestAnimationFrame(() => t?.focus?.());
  }

  return (
    <div className="crate-view">
      <AnimatePresence mode="wait" initial={false}>
        {level === "shelf" ? (
          <motion.div key="shelf" exit={{ opacity: 0 }} transition={{ duration: reduce ? 0.12 : DUR.base }}>
            <CrateControls
              groupBy={groupBy} setGroupBy={setGroupBy}
              crateSort={crateSort} setCrateSort={setCrateSort}
              search={search} setSearch={setSearch}
              onDigAll={() => open("__all__")}
              reduceMotion={manualReduce} setReduceMotion={setManualReduce}
            />
            {loading
              ? <div className="crate-empty">Loading your collection…</div>
              : crates.length === 0
              ? (search
                ? <EmptyCrate searching title="No projects match your search">Try fewer letters, or clear the search box.</EmptyCrate>
                : <EmptyCrate title="Nothing to dig through yet">Scan your project folders in the Library and your projects land here in crates.</EmptyCrate>)
              : <>
                  {folderCrates.length > 0 && <>
                    <div className="crate-section"><h2>Your folders</h2><span>Made in the Library. Your files stay where they are.</span></div>
                    <CrateShelf groups={folderCrates.slice(0, FOLDER_SHELF)} onOpen={open} reduce={reduce} label="Your folders"
                      more={folderCrates.length > FOLDER_SHELF
                        ? { title: "All folders…", count: folderWord(folderCrates.length), onOpen: () => open("__folders__") } : undefined} />
                  </>}
                  {smart.length > 0 && <>
                    <div className="crate-section"><h2>Smart crates</h2><span>Saved from the Library's filters. They fill themselves.</span></div>
                    <CrateShelf groups={smart} onOpen={open} reduce={reduce} label="Smart crates" />
                  </>}
                  {(smart.length > 0 || folderCrates.length > 0) && <>
                    <div className="crate-section"><h2>{groupBy === "genre" ? "By genre" : groupBy === "daw" ? "By DAW" : groupBy === "tempo" ? "By tempo" : "By recency"}</h2></div>
                  </>}
                  <CrateShelf groups={crates} onOpen={open} reduce={reduce} />
                </>}
          </motion.div>
        ) : level === "folders" ? (
          <motion.div key="folders" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0.12 : DUR.base }}>
            <div className="dig-header">
              <button className="btn btn--ghost btn--sm" onClick={back} aria-label="Back to crates" autoFocus><Icon name="arrowLeft" size={14} />Crates</button>
              <h2 className="dig-title">Your folders</h2>
              <span className="faint mono">{folderWord(allFolders.length)}</span>
              <input className="crate-search grow" type="text" placeholder="Search folders…" value={folderSearch}
                onChange={(e) => setFolderSearch(e.target.value)} aria-label="Search folders" spellCheck={false} data-find
                onKeyDown={(e) => { if (e.key === "Escape" && folderSearch) { e.stopPropagation(); setFolderSearch(""); } }} />
            </div>
            {allFolders.length === 0
              ? <EmptyCrate searching title="No folders match">
                  Try fewer letters, or <button className="linkbtn" onClick={() => setFolderSearch("")}>clear the search</button>.
                </EmptyCrate>
              : <CrateShelf groups={allFolders} onOpen={open} reduce={reduce} label="Your folders" />}
          </motion.div>
        ) : (
          <motion.div key="dig" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0.12 : DUR.base }}>
            <CrateDig
              group={openGroup!} all={projects}
              active={active} setActive={setActive}
              digSort={digSort} setDigSort={setDigSort}
              verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly}
              onBack={back} onOpenProject={onOpenProject} reduce={reduce}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
