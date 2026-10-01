import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DUR } from "./motion";
import type { GroupBy, CrateSort, DigSort, CrateGroup, Project } from "./types";
import { toProjectFromLibrary, SLOTH_BLUE } from "./types";
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
export function CrateView({ onOpenProject }: { onOpenProject?: (name: string) => void }) {
  const osReduce = useReducedMotion();
  const [manualReduce, setManualReduce] = useState(false);
  const reduce = !!osReduce || manualReduce;

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api.library()
      .then((lib) => { if (alive) setProjects(lib.projects.map(toProjectFromLibrary)); })
      .catch(() => { /* leave empty */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const [groupBy, setGroupBy] = useState<GroupBy>("genre");
  const [crateSort, setCrateSort] = useState<CrateSort>("count");
  const [search, setSearch] = useState("");
  const crates = useCrates(projects, groupBy, crateSort, search);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [digSort, setDigSort] = useState<DigSort>("recent");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const openGroup: CrateGroup | null =
    openKey === "__all__"
      ? { key: "__all__", label: "All records", accent: SLOTH_BLUE, projects, count: projects.length }
      : crates.find((c) => c.key === openKey) ?? null;
  const level: "shelf" | "dig" = openGroup ? "dig" : "shelf";

  function open(key: string) {
    triggerRef.current = document.activeElement as HTMLElement;
    setActive(0);
    setOpenKey(key);
  }
  function back() {
    setOpenKey(null);
    const t = triggerRef.current;
    requestAnimationFrame(() => t?.focus?.());
  }

  return (
    <div className="crate-view">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <label className="toolchk">
          <input type="checkbox" checked={manualReduce} onChange={(e) => setManualReduce(e.target.checked)} /> Reduce motion
        </label>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {level === "shelf" ? (
          <motion.div key="shelf" exit={{ opacity: 0 }} transition={{ duration: reduce ? 0.12 : DUR.base }}>
            <CrateControls
              groupBy={groupBy} setGroupBy={setGroupBy}
              crateSort={crateSort} setCrateSort={setCrateSort}
              search={search} setSearch={setSearch}
              onDigAll={() => open("__all__")}
            />
            {loading
              ? <div className="crate-empty">Loading your collection…</div>
              : crates.length === 0
              ? <EmptyCrate message={search ? "No projects match your search." : "Nothing scanned yet — run a scan and your projects land in crates."} />
              : <CrateShelf groups={crates} onOpen={open} reduce={reduce} />}
          </motion.div>
        ) : (
          <motion.div key="dig" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0.12 : DUR.base }}>
            <CrateDig
              group={openGroup!}
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
