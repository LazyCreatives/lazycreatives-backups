export function ProgressBar({ value, max, active }: { value: number; max: number; active?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div className={`progress__fill${active ? " progress__fill--active" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
