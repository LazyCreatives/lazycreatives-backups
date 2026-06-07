// A celebratory "verified" stamp: badge stamps in with overshoot, rays burst
// out, and the check draws itself. Pure CSS (see theme.css .seal*).
export function VerifiedSeal({ size = 64 }: { size?: number }) {
  return (
    <div className="seal seal--ok" style={{ width: size, height: size }}>
      <span className="seal__ray" />
      <span className="seal__ray" />
      <svg className="seal__badge" viewBox="0 0 56 56" aria-hidden>
        <circle className="seal__disc" cx="28" cy="28" r="25" />
        <path className="seal__check" d="M16 29 l8 8 l16 -18" />
      </svg>
    </div>
  );
}
