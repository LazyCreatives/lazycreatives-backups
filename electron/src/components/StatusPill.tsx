export function StatusPill({ status }: { status: string }) {
  const cls = status === "ok" ? "pill pill--ok"
    : status === "error" ? "pill pill--error"
    : status === "running" ? "pill pill--running" : "pill";
  return <span className={cls}>{status}</span>;
}
