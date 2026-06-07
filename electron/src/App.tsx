import { useState } from "react";
import { Nav } from "./components/Nav";
import { Dashboard } from "./screens/Dashboard";
import { Sources } from "./screens/Sources";
import { Scan } from "./screens/Scan";
import { Backup } from "./screens/Backup";
import { Browse } from "./screens/Browse";
import type { ProjectSummary } from "./types";

export type Screen = "dashboard" | "sources" | "scan" | "backup" | "browse";

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  // Scan results live here, not inside <Scan>, so navigating away and back does not
  // discard them — a scan can take tens of seconds, so losing it on a click is rough.
  const [scanProjects, setScanProjects] = useState<ProjectSummary[] | null>(null);
  return (
    <div className="app">
      <Nav screen={screen} onNavigate={setScreen} />
      <div className="main">
        {screen === "dashboard" && <Dashboard />}
        {screen === "sources" && <Sources />}
        {screen === "scan" && (
          <Scan
            projects={scanProjects}
            onProjects={setScanProjects}
            onBackupStarted={() => setScreen("backup")}
          />
        )}
        {screen === "backup" && <Backup />}
        {screen === "browse" && <Browse />}
      </div>
    </div>
  );
}
