import slothUrl from "../assets/lazy-creatives-sloth.png";

// Sidebar header shared by both Lazy Creatives apps: the small headphone sloth,
// the app name in brush lettering and a quiet line underneath. SHARED FILE: the
// same component lives in Backups (electron/src/components/LcBrand.tsx).
// `busy` gently fades the sloth while the app is working.
export function LcBrand({ app, tag, busy = false }: { app: string; tag: string; busy?: boolean }) {
  return (
    <div className="lc-brand" title={`Lazy Creatives ${app}`}>
      <img className={`lc-brand__mark${busy ? " lc-brand__mark--busy" : ""}`} src={slothUrl}
        alt="" draggable={false} />
      <div className="lc-brand__text">
        <span className="lc-brand__name">{app}</span>
        <span className="lc-brand__tag">{tag}</span>
      </div>
    </div>
  );
}
