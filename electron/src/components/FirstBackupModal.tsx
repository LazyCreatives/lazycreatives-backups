import { useEffect, useRef } from "react";
import { useDialogFocus } from "./a11y";
import { VerifiedSeal } from "./VerifiedSeal";
import { Button } from "./Button";
import { SlothSpot } from "./SlothSpot";

// A one-time explainer after the user's first successful backup: the seal, and the
// sloth hugging the drive with its own line (the house voice, not an emoji), then the
// payoff (we gathered scattered samples + checked they're all readable).
export function FirstBackupModal({ completed, onHistory, onClose }: {
  completed: number; onHistory: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const ref = useRef<HTMLDivElement | null>(null);
  useDialogFocus(ref);
  return (
    <div className="modal__scrim" onClick={onClose}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="firstbackup-title" onClick={(e) => e.stopPropagation()}>
        <div className="firstbackup__art">
          <VerifiedSeal size={64} />
          <SlothSpot pose="hugging-drive" size={96} />
        </div>
        <p className="empty__say firstbackup__say">Got it. All of it.</p>
        <h2 id="firstbackup-title" style={{ margin: "6px 0 8px" }}>Your first backup is done</h2>
        <p className="sub" style={{ margin: 0, maxWidth: 400, lineHeight: 1.6 }}>
          {completed} project{completed === 1 ? "" : "s"} protected. We followed every sample —
          even the ones scattered across other folders — <strong style={{ color: "var(--accent)" }}>gathered them
          into one tidy backup</strong>, and re-read each file to make sure it all opens.
          It's on your own drive; <strong style={{ color: "var(--text)" }}>you own it</strong>.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <Button onClick={onHistory}>See your backed-up projects →</Button>
          <Button variant="ghost" onClick={onClose}>Got it</Button>
        </div>
      </div>
    </div>
  );
}
