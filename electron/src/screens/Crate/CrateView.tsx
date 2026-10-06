import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DUR } from "./motion";
import type { GroupBy, CrateSort, DigSort, CrateGroup, Project } from "./types";
import { toProjectFromLibrary, SLOTH_BLUE } from "./types";
import type { LibraryItem } from "../../types";
import { NO_FILTERS, applyFilters, type LibFilters } from "../../libraryFilter";
import { useSmartCrates } from "../../smart";
import { genreColor, genreColorsVersion } from "../../look";
import { ratingOf, useRatings } from "../../marks";
import { makeApi } from "../../api";
import { useCrates } from "./hooks/useCrates";
import { CrateControls } from "./CrateControls";
import { CrateShelf } from "./CrateShelf";
import { CrateDig } from "./CrateDig";
import { EmptyCrate } from "./EmptyCrate";
import "./crate.css";

const api = makeApi();

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

  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
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

  const [active, setActive] = useKept("active");
  const [digSort, setDigSort] = useKept("digSort");
  const [verifiedOnly, setVerifiedOnly] = useKept("verifiedOnly");
  const triggerRef = useRef<HTMLElement | null>(null);

  const openGroup: CrateGroup | null =
    openKey === "__all__"
      ? { key: "__all__", label: "All records", accent: SLOTH_BLUE, projects, count: projects.length }
      : crates.find((c) => c.key === openKey) ?? smart.find((c) => c.key === openKey) ?? null;
  const level: "shelf" | "dig" = openGroup ? "dig" : "shelf";

  function open(key: string) {
    triggerRef.current = document.activeElement as HTMLElement;
    setActive(0);
    onOpenKey(key);
  }
  function back() {
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
                  {smart.length > 0 && <>
                    <div className="crate-section"><h2>Smart crates</h2><span>Saved from the Library's filters. They fill themselves.</span></div>
                    <CrateShelf groups={smart} onOpen={open} reduce={reduce} label="Smart crates" />
                    <div className="crate-section"><h2>{groupBy === "genre" ? "By genre" : groupBy === "daw" ? "By music app" : groupBy === "tempo" ? "By tempo" : "By recency"}</h2></div>
                  </>}
                  <CrateShelf groups={crates} onOpen={open} reduce={reduce} />
                </>}
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
