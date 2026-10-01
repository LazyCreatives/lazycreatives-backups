export function StatusPill({ status }: { status: string }) {
  const cls = status === "ok" ? "pill pill--ok"
    : status === "error" ? "pill pill--error"
    : status === "partial" ? "pill pill--partial"
    : status === "running" ? "pill pill--running" : "pill";
  const label = status === "partial" ? "missing samples" : status;
  return <span className={cls}>{label}</span>;
}
