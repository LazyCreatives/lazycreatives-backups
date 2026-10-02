import { useId } from "react";
import { coverColor, hash, shade } from "../look";

// Cover art drawn from a project's name and genre: one of four sleeve designs in the
// genre's colour, the same every time. Same file in Backups and Uploader.
function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909);
    return (x >>>= 0) / 4294967296;
  };
}

export function Cover({ name, genre, size, className = "", label = true }: {
  name: string; genre?: string | null; size?: number; className?: string; label?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const c = coverColor(genre, name);
  const h = hash(name);
  const r = rng(h);
  const kind = h % 4;
  const shapes: JSX.Element[] = [];
  if (kind === 0) {
    for (let i = 9; i > 0; i--)
      shapes.push(<circle key={i} cx={30 + r() * 40} cy={30 + r() * 40} r={i * 6} fill="none"
        stroke={shade(c, 0.15)} strokeOpacity={0.12 + i * 0.05} strokeWidth={1 + r() * 2} />);
  } else if (kind === 1) {
    for (let i = 0; i < 9; i++)
      shapes.push(<rect key={i} x={-20 + i * 14} y={-10} width={4 + r() * 7} height={140}
        transform="rotate(28 50 50)" fill={shade(c, 0.1 + r() * 0.3)} opacity={0.25 + r() * 0.5} />);
  } else if (kind === 2) {
    shapes.push(<circle key="c" cx={35 + r() * 30} cy={38 + r() * 20} r={22 + r() * 10} fill={shade(c, 0.2)} />);
    shapes.push(<rect key="a" x={0} y={70 + r() * 12} width={100} height={5} fill={shade(c, 0.45)} />);
    shapes.push(<rect key="b" x={0} y={82 + r() * 8} width={100} height={2} fill={shade(c, 0.45)} opacity={0.6} />);
  } else {
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++) {
        const v = r();
        shapes.push(<circle key={`${x}-${y}`} cx={12 + x * 15.2} cy={12 + y * 15.2} r={1.5 + v * 5.5}
          fill={shade(c, 0.1 + v * 0.5)} opacity={0.35 + v * 0.6} />);
      }
  }
  return (
    <svg className={`cover ${className}`.trim()} viewBox="0 0 100 100" aria-hidden
      width={size} height={size} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(c, -0.35)} />
          <stop offset="1" stopColor={shade(c, -0.75)} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id})`} />
      {shapes}
      {label && (size == null || size >= 80) &&
        <text x="7" y="94" fontFamily="Geist Mono, monospace" fontSize="7" fill="#fff" opacity="0.55">
          LC·{String(h % 1000).padStart(3, "0")}
        </text>}
    </svg>
  );
}
