export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = { ok: "var(--accent-2)", error: "var(--danger)", running: "var(--warn)" };
  const c = map[status] ?? "var(--text-dim)";
  return (
    <span style={{
      color: c, border: `1px solid ${c}`, borderRadius: 999,
      padding: "2px 10px", fontSize: 12, fontWeight: 600, textTransform: "capitalize",
    }}>{status}</span>
  );
}
