// A small tier tag for gated features (PRO by default; STUDIO for top-tier ones).
export function ProBadge({ label = "PRO" }: { label?: string }) {
  return <span className="pro-badge">{label}</span>;
}
