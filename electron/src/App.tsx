import { useEffect, useRef, useState } from "react";
import { Nav } from "./components/Nav";
import { Setup } from "./screens/Setup";
import { Home } from "./screens/Home";
import { Sources } from "./screens/Sources";
import { BackupFlow } from "./screens/BackupFlow";
import { Browse } from "./screens/Browse";
import { makeApi } from "./api";
import { useLiveProgress } from "./useProgress";
import type { Config, ProjectSummary } from "./types";

const api = makeApi();

export type Tab = "home" | "history" | "settings";
export type FlowStep = "scan" | "review" | "progress";

export interface PendingBackup {
  als_paths: string[];
  count: number;
  size: number;
  findMissing: boolean;
}

function isConfigured(c: Config): boolean {
  return c.sources.length > 0 && !!c.dest;
}

export default function App() {
  const [cfg, setCfg] = useState<Config | null | "error">(null);
  const [tab, setTab] = useState<Tab>("home");
  const [flow, setFlow] = useState<FlowStep | null>(null);
  const [scanProjects, setScanProjects] = useState<ProjectSummary[] | null>(null);
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const live = useLiveProgress();

  useEffect(() => { api.getSettings().then(setCfg).catch(() => setCfg("error")); }, []);

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
    prevDone.current = live.backup.done;
  }, [live.backup.done, live.backup.completed, live.backup.errors, live.backup.cancelled]);

  if (cfg === null) return <div className="splash">Loading…</div>;
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
    return <Setup onDone={(c) => { setCfg(c); setTab("home"); setFlow("scan"); }} />;
  }

  const busy = live.scan.active || live.backup.active;

  return (
    <div className="app">
      <Nav tab={tab} flowActive={!!flow} busy={busy}
        onNavigate={(t) => { setTab(t); setFlow(null); }} />
      <div className="main">
        <div className="content">
          {flow ? (
            <BackupFlow
              step={flow}
              projects={scanProjects}
              onProjects={setScanProjects}
              scan={live.scan}
              backup={live.backup}
              pending={pending}
              activeJob={activeJob}
              onReview={(p) => { setPending(p); setFlow("review"); }}
              onStarted={(jobId) => { setActiveJob(jobId); setFlow("progress"); }}
              onBackToScan={() => setFlow("scan")}
              onExit={() => { setFlow(null); setTab("home"); }}
            />
          ) : tab === "home" ? (
            <Home
              backup={live.backup}
              onBackupNow={() => setFlow("scan")}
              onOpenSettings={() => setTab("settings")}
              onResumeProgress={() => setFlow("progress")}
            />
          ) : tab === "history" ? (
            <Browse />
          ) : (
            <Sources />
          )}
        </div>
      </div>
    </div>
  );
}
