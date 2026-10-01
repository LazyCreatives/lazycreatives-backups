import { Scan } from "./Scan";
import { Review } from "./Review";
import { Backup } from "./Backup";
import { Button } from "../components/Button";
import type { FlowStep, PendingBackup } from "../App";
import type { ScanProgress, BackupProgress } from "../useProgress";
import type { ProjectSummary } from "../types";

const STEPS: { id: FlowStep; label: string }[] = [
  { id: "scan", label: "Scan" },
  { id: "review", label: "Review" },
  { id: "progress", label: "Run" },
];
const order = (s: FlowStep) => STEPS.findIndex((x) => x.id === s);

export function BackupFlow({ step, projects, onProjects, scan, backup, pending, activeJob,
  onBackup, onReview, onStarted, onBackToScan, onExit }: {
  step: FlowStep;
  projects: ProjectSummary[] | null;
  onProjects: (p: ProjectSummary[] | null) => void;
  scan: ScanProgress;
  backup: BackupProgress;
  pending: PendingBackup | null;
  activeJob: string | null;
  onBackup: (p: PendingBackup) => void;
  onReview: (p: PendingBackup) => void;
  onStarted: (jobId: string) => void;
  onBackToScan: () => void;
  onExit: () => void;
}) {
  const cur = order(step);
  return (
    <>
      <div className="flowbar">
        <div className="flowbar__steps">
          {STEPS.map((s, i) => (
            <span key={s.id}
              className={`flowstep${s.id === step ? " flowstep--on" : ""}${i < cur ? " flowstep--done" : ""}`}>
              <span className="flowstep__n">{i < cur ? "✓" : i + 1}</span>{s.label}
            </span>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>
          {step === "progress" && backup.done ? "Done" : "Close"}
        </Button>
      </div>

      {step === "scan" && (
        <Scan projects={projects} onProjects={onProjects} scan={scan} onBackup={onBackup} onReview={onReview} />
      )}
      {step === "review" && (
        <Review pending={pending} onStarted={onStarted} onCancel={onBackToScan} />
      )}
      {step === "progress" && (
        <Backup progress={backup} jobId={activeJob} />
      )}
    </>
  );
}
