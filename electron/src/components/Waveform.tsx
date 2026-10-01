import type { CSSProperties } from "react";

// A decorative, gently-breathing audio waveform (the brand's gold motif). Each
// bar has a fixed pseudo-random height + staggered delay so it flows like a meter.
export function Waveform({ bars = 56 }: { bars?: number }) {
  return (
    <div className="waveform" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const h = 18 + (Math.sin(i * 0.9) + Math.sin(i * 0.37) + 2) * 20; // 18%–98%, deterministic
        return <span key={i} style={{ height: `${h}%`, animationDelay: `${(i % 14) * -0.11}s` } as CSSProperties} />;
      })}
    </div>
  );
}
