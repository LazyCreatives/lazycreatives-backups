import { useAuditionMode } from "../audition";
import { Icon } from "./Icon";

// The "Preview on hover" switch that sits beside a list's view controls.
// SHARED FILE: the same file lives in Backups and Uploader (components/Audition.tsx).
export function AuditionToggle({ compact = false }: { compact?: boolean }) {
  const [on, set] = useAuditionMode();
  return (
    <button type="button" className={`audition-toggle${on ? " audition-toggle--on" : ""}`} aria-pressed={on}
      title={on ? "Previewing on hover. Point at a song to hear it; Up and Down move through the list" : "Preview on hover: point at a song to hear a few seconds of it"}
      onClick={() => set(!on)}>
      <Icon name="headphones" size={15} />
      {!compact && <span>Preview on hover</span>}
    </button>
  );
}
