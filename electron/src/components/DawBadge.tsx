import { dawLabel } from "../format";

// Brand-accurate badge colours per DAW (no trademarked logos — those aren't licensed
// for a paid product; a coloured name tag is the safe, conventional "works with X").
// Solid chip + near-black text reads cleanly on Studio Black.
const DAW_COLOR: Record<string, string> = {
  ableton: "#C8CDD2",     // Ableton Live — monochrome brand → cool light grey
  flstudio: "#F2700F",    // FL Studio — Image-Line orange
  reaper: "#E8B84B",      // REAPER — warm amber
  dawproject: "#5BC8C8",  // DAWproject (Bitwig / Studio One) — teal
  audacity: "#4FA8F0",    // Audacity — azure
};

export function DawBadge({ daw }: { daw?: string }) {
  const color = daw ? DAW_COLOR[daw] : undefined;
  return (
    <span className="daw-badge" style={color ? { background: color, color: "#0A0B0D" } : undefined}>
      {dawLabel(daw)}
    </span>
  );
}
