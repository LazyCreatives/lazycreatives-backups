import type { ReactNode } from "react";
import { LcBrand } from "./LcBrand";
import { LookPicker } from "./LookPicker";

// The first-run card: brand, "Step N of 3" with a bar, a heading, the step itself and
// Back / Next at the bottom. Same file in Backups and Uploader, so both welcomes match.
export function WelcomeCard({ app, step, title, sub, foot, children }: {
  app: string; step: 1 | 2 | 3; title: string; sub?: ReactNode; foot: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="splash welcome-splash">
      <div className="welcome">
        <div className="welcome__head">
          <LcBrand app={app} tag="Lazy Creatives" />
          <span className="welcome__count num">Step {step} of 3</span>
        </div>
        <div className="welcome__bar" aria-hidden="true">
          {[1, 2, 3].map((i) => <span key={i} className={`welcome__seg${i <= step ? " welcome__seg--on" : ""}`} />)}
        </div>
        <div className="welcome__body" key={step}>
          <h1>{title}</h1>
          {sub && <p className="sub welcome__sub">{sub}</p>}
          {children}
        </div>
        <div className="welcome__foot">{foot}</div>
      </div>
    </div>
  );
}

// Step 1's look choice. Picking one restyles the whole app straight away, this card included.
export function WelcomeLook() {
  return (
    <div className="welcome__look">
      <div className="welcome__label">Pick a look</div>
      <LookPicker />
      <p className="welcome__hint">You can change it any time in Settings.</p>
    </div>
  );
}
