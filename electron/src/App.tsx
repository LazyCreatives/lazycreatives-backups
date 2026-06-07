import { useEffect, useRef, useState } from "react";
import { Nav } from "./components/Nav";
import { Dashboard } from "./screens/Dashboard";
import { Sources } from "./screens/Sources";
import { Scan } from "./screens/Scan";
import { Review } from "./screens/Review";
import { Backup } from "./screens/Backup";
import { Browse } from "./screens/Browse";
import { useLiveProgress } from "./useProgress";
import type { ProjectSummary } from "./types";

export type Screen = "dashboard" | "sources" | "scan" | "review" | "backup" | "browse";

export interface PendingBackup {
  als_paths: string[];
  count: number;
  size: number;
  findMissing: boolean;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  // Scan results + the pending backup selection live here so they survive navigation.
  const [scanProjects, setScanProjects] = useState<ProjectSummary[] | null>(null);
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const live = useLiveProgress();

  // Fire a single OS notification when a backup finishes, from anywhere in the app.
  const prevDone = useRef(false);
  useEffect(() => {
    if (live.backup.done && !prevDone.current) {
      new Notification("Ableton Backup", {
        body: `Backup finished — ${live.backup.completed} ok, ${live.backup.errors} error(s).`,
      });
    }
    prevDone.current = live.backup.done;
  }, [live.backup.done, live.backup.completed, live.backup.errors]);

  const busy = live.scan.active || live.backup.active;

  return (
    <div className="app">
      <Nav screen={screen} onNavigate={setScreen} busy={busy} />
      <div className="main">
        <div className="content">
          {screen === "dashboard" && <Dashboard onNavigate={setScreen} />}
          {screen === "sources" && <Sources />}
          {screen === "scan" && (
            <Scan
              projects={scanProjects}
              onProjects={setScanProjects}
              scan={live.scan}
              onReview={(p) => { setPending(p); setScreen("review"); }}
            />
          )}
          {screen === "review" && (
            <Review
              pending={pending}
              onStarted={() => setScreen("backup")}
              onCancel={() => setScreen("scan")}
            />
          )}
          {screen === "backup" && <Backup progress={live.backup} />}
          {screen === "browse" && <Browse />}
        </div>
      </div>
    </div>
  );
}
