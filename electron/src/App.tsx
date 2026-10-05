import { useEffect, useRef, useState } from "react";
import { Nav } from "./components/Nav";
import { Setup } from "./screens/Setup";
import { Home } from "./screens/Home";
import { Sources } from "./screens/Sources";
import { BackupFlow } from "./screens/BackupFlow";
import { Library } from "./screens/Library";
import { Dig } from "./screens/Dig";
import { LcBrand } from "./components/LcBrand";
import { FirstBackupModal } from "./components/FirstBackupModal";
import { WhatsNewHost } from "./components/WhatsNew";
import { makeApi } from "./api";
import { useLiveProgress } from "./useProgress";
import type { Config, ProjectSummary } from "./types";
import { PlayerBar } from "./components/Player";
import { useBackForwardInput, useNav, type Place } from "./nav";

const api = makeApi();

export type Tab = "home" | "library" | "dig" | "settings";
export type FlowStep = "scan" | "review" | "progress";

export interface PendingBackup {
  als_paths: string[];
  names?: string[];   // project names, for the covers on the review screen
  count: number;
  size: number;
  findMissing: boolean;
}

function isConfigured(c: Config): boolean {
  return c.sources.length > 0 && !!c.dest;
}

export default function App() {
  const [cfg, setCfg] = useState<Config | null | "error">(null);
  // Where you are: a tab, maybe an open project or crate on it, maybe a backup flow
  // step on top. Kept as a back/forward history (side mouse buttons, Alt+arrows).
  const nav = useNav<Place & { tab: Tab; flow?: FlowStep | null }>({ tab: "home" });
  useBackForwardInput(nav.back, nav.forward);
  const { tab } = nav.place;
  const flow = nav.place.flow ?? null;
  const sub = nav.place.sub ?? null;
  const setTab = (t: Tab, open: string | null = null) => nav.go({ tab: t, sub: open, flow: null });
  // steps inside one backup replace each other, so Back leaves the flow in one press
  const setFlow = (f: FlowStep | null) => f
    ? nav.go({ tab, sub, flow: f }, { replace: !!flow })
    : nav.go({ tab, sub, flow: null });
  // Close an open project/crate: step back if that's where we came from, else go to the list.
  const closeSub = () => {
    const p = nav.prev;
    if (p && p.tab === tab && !p.sub && !p.flow) nav.back(); else setTab(tab);
  };
  const [scanProjects, setScanProjects] = useState<ProjectSummary[] | null>(null);
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [showFirstBackup, setShowFirstBackup] = useState(false);
  const live = useLiveProgress();

  // Was the app already set up when it opened? Only then can "What's new" show
  // on a first run of this version (a fresh install has nothing new to show).
  const setUpAtOpen = useRef<boolean | null>(null);
  useEffect(() => {
    api.getSettings().then((c) => {
      if (setUpAtOpen.current === null) setUpAtOpen.current = isConfigured(c);
      setCfg(c);
    }).catch(() => setCfg("error"));
  }, []);

  // Notification permission, once.
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // One OS notification when a backup finishes, from anywhere.
  const prevDone = useRef(false);
  useEffect(() => {
    if (live.backup.done && !prevDone.current && "Notification" in window && Notification.permission === "granted") {
      new Notification("LazyCreatives Backups", {
        body: live.backup.cancelled
          ? `Backup cancelled — ${live.backup.completed} done.`
          : `Backup finished — ${live.backup.completed} ok, ${live.backup.errors} error(s).`,
      });
    }
    // One-time onboarding: explain the payoff after the very first successful backup.
    if (live.backup.done && !prevDone.current && !live.backup.cancelled
        && live.backup.completed > 0 && !localStorage.getItem("lc_onboarded")) {
      localStorage.setItem("lc_onboarded", "1");
      setShowFirstBackup(true);
    }
    prevDone.current = live.backup.done;
  }, [live.backup.done, live.backup.completed, live.backup.errors, live.backup.cancelled]);

  // One-click backup: start straight from Scan with smart defaults (opens-anywhere
  // + gather-missing), skipping the Review step. Falls back to Review on error.
  async function launchBackup(p: PendingBackup) {
    try {
      const { job_id } = await api.startBackup({
        als_paths: p.als_paths, find_missing: p.findMissing,
        portable: true, layout: "project_date",
      });
      setActiveJob(job_id);
      setFlow("progress");
    } catch {
      setPending(p);
      setFlow("review");
    }
  }

  if (cfg === null) return (
    <div className="splash">
      <div style={{ display: "grid", placeItems: "center", gap: 14 }}>
        <LcBrand app="Backups" tag="Starting…" busy />
      </div>
    </div>
  );
  if (cfg === "error") {
    return (
      <div className="splash">
        <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)", maxWidth: 380 }}>
          Couldn't reach the backup service.
        </div>
      </div>
    );
  }
  if (!isConfigured(cfg)) {
    return <Setup onDone={(c) => { setCfg(c); nav.go({ tab: "home", flow: "scan" }, { replace: true }); }} />;
  }

  const busy = live.scan.active || live.backup.active;

  return (
    <div className="app">
      <Nav tab={tab} flowActive={!!flow} busy={busy}
        onNavigate={(t) => setTab(t)} />
      <div className="main">
        <div className="content">
          <div key={flow ?? tab} className="view-enter">
          {flow ? (
            <BackupFlow
              step={flow}
              projects={scanProjects}
              onProjects={setScanProjects}
              scan={live.scan}
              backup={live.backup}
              pending={pending}
              activeJob={activeJob}
              onBackup={launchBackup}
              onReview={(p) => { setPending(p); setFlow("review"); }}
              onStarted={(jobId) => { setActiveJob(jobId); setFlow("progress"); }}
              onBackToScan={() => setFlow("scan")}
              onExit={() => setTab("home")}
            />
          ) : tab === "home" ? (
            <Home
              backup={live.backup}
              onBackupNow={() => setFlow("scan")}
              onOpenSettings={() => setTab("settings")}
              onResumeProgress={() => setFlow("progress")}
              onOpenHistory={() => setTab("library")}
              onOpenProject={(name) => setTab("library", name)}
            />
          ) : tab === "library" ? (
            <Library scan={live.scan} openProject={sub}
              onOpen={(id) => setTab("library", id)} onClose={closeSub} />
          ) : tab === "dig" ? (
            <Dig openCrate={sub} onOpenCrate={(key) => setTab("dig", key)} onCloseCrate={closeSub}
              onOpenProject={(name) => setTab("library", name)} />
          ) : (
            <Sources />
          )}
          </div>
        </div>
      </div>
      <PlayerBar />
      <WhatsNewHost setUp={setUpAtOpen.current === true} />
      {showFirstBackup && (
        <FirstBackupModal
          completed={live.backup.completed}
          onHistory={() => { setShowFirstBackup(false); setTab("library"); }}
          onClose={() => setShowFirstBackup(false)}
        />
      )}
    </div>
  );
}
