import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      gap: 16, marginBottom: 20,
    }}>
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="sub" style={{ margin: 0 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}
