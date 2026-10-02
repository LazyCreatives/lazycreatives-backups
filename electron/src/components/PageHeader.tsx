import type { ReactNode } from "react";

// Page title, one plain line under it, and the page's buttons on the right
// (the main button last). Same layout as Uploader's PageHeader.
export function PageHeader({ title, subtitle, actions }: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {subtitle && <p className="sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}
