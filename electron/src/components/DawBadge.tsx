import { dawLabel } from "../format";

// Which music app a project was made in, as a small outlined tag. All apps share
// one neutral style so the only colours in a list are the status dots.
export function DawBadge({ daw }: { daw?: string }) {
  return <span className="daw-badge">{dawLabel(daw)}</span>;
}
