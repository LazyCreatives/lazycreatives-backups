import { VerifiedSeal } from "./VerifiedSeal";
import { Button } from "./Button";

// A one-time celebratory explainer after the user's first successful backup —
// teaches the payoff (we gathered scattered samples + checked they're all readable).
export function FirstBackupModal({ completed, onHistory, onClose }: {
  completed: number; onHistory: () => void; onClose: () => void;
}) {
  return (
    <div className="modal__scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <VerifiedSeal size={64} />
        <h2 style={{ margin: "14px 0 8px" }}>Your first backup is done 🎉</h2>
        <p className="sub" style={{ margin: 0, maxWidth: 400, lineHeight: 1.6 }}>
          {completed} project{completed === 1 ? "" : "s"} protected. We followed every sample —
          even the ones scattered across other folders — <strong style={{ color: "var(--accent)" }}>gathered them
          into one tidy backup</strong>, and re-read each file to make sure it all opens.
          It's on your own drive; <strong style={{ color: "var(--text)" }}>you own it</strong>.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <Button onClick={onHistory}>See what we gathered →</Button>
          <Button variant="ghost" onClick={onClose}>Got it</Button>
        </div>
      </div>
    </div>
  );
}
