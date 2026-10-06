import { useId } from "react";
import { coverColor, hash, shade } from "../look";

// Cover art for a project, made like a printed record sleeve: one of four layouts in the
// genre's colour (the name set big in type, a record sliding out of its sleeve, a band of
// sound, a plain print of shapes), with a little paper grain and a catalogue number.
// The same name and genre always give the same cover. Same file in Backups and Uploader.
function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x = Math.imul(x ^ (x >>> 15), 2246822507) ^ Math.imul(x ^ (x >>> 13), 3266489909);
    return (x >>>= 0) / 4294967296;
  };
}

// 32x32 speckle tile, laid over every cover so it reads as printed card, not a screen fill
const GRAIN = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFi0lEQVR42k2X53bqMBCEhU03vRtCLwYCoRgI7/9i9+44n87hhyJjydLuzOxIcf/+/atYOzjn8taG1hbWAmsTe693BetD6xvWNjxrvKNvebe2vsj3et5YS6zNbexmbWptaK1p706subT2dvbnx1rHXpasrxLQ2H4frV3tuW9tZ21LQG3rtUiowPWtFrKWszbwG1ur2++y9bH1v9YK9vylYLONnXvovQI460NrylCTKmyusad1Lev1c2x9wqLKSAvH9jwDFQX3RSI7EBESK5DReEKC2m+muQ54ZkRYtP7C4JIsKiAhmk5AJ6RuWtz6PVmnZHWxvgYaOdbWb2U/hMoG7+oKICELLaCMR/qNBgoEqEV/rFW1qLUt85XRkSBzBKHAJwqGAJTEgiRaoBqyruZkEOmjX7ISfOojApGoejZ2t17cSUht5iwQ4BV+E1D6YtMT409RZ63EWJ4gMwTuLHaGH20ytXZBQMpakC8QpKDrCRGEJ1GJ+xH0LDJu/4IVgj7YNhS90M4qEzMwh0SkSeI0RRP5TKl/AfVZLGCDFih1tTFluaBKUsYd1Cn4prUilK1ISNX0JwiyDflob88KSL+PlNEOSANrERs56ntNjb/hPCJgj0ATNMS5UN5qPwXvUHGBja74giYp8oB+iagKILAnmycc72lzgkqhUOWsqhIaL4JUwpondL8dwkuo0z7mkuADIRkIqm9MR+qdIs4uQu2wYDsrrb+1KpTdDl1JYw1MK6ai5g5D+cFoRijVgYYyFN9nnwkbqVSHzHmhnRA0xfUEsd7ZPKX/YZ5Eq0TlmFkmUvmYDFtE2IVbBeDPCl92X2w+4XtBGzHWI7iUSriQ2IVK6UPVBlfNxNEEiQkZlTGiLTYcE/UdJ6tQUgVE2yCjMqV4woq7bNqA0ikl7P0l58+CEPt8o9wG/M1R/hm114Dzgk3X0FCDb66IM+HdGGOLM9P5ex5DaZQlBf/KpM/LgFp9YjxVshTPA7hck5mOWo/EmYBW9EOMqsmaAQ7YokJ2WZJw0kLBDk8vkvUNIU2ANwKBB9n0gPXOPSJGhHnOlyoB50GljtjPrFV2lJQiuiHCDdFfyKSJyLxN99BEE3GK+wCO3/j+EFNqYGY7glgg4BtJKqBMsRU4DTCcB1URkU1AReS9nWI8B4IZQ9uY6hkDvx+vY/X+lIxJPKuCkCwKiKvCDWlJ6YnrK4p++gsIvO85khMyjwh2yXcl0Atw2hK3qzWGpzWzcjtyTEa+XIDqCecxwQyANwXOgDK++SsaGlJANWhQMt9eB+giQbwVx6lUJ4seNERM/Mb17mSz52BaI1zvjkPvjFzLIuy5S5Vd8IoO9ISUeOJV74BDJrJCqVt0kXyU4pkN8lxgYirnALQ7xOmpjaHAn7IVhP3AVfP+NBRUZ3i7oIcIpTa4aF6Y0waZDv5RZdMqi/dZR273QngbSjXmouqvcHJLN+C0y6HKE5DlcT4FV6SGS/D+YIMy9tzBtFropIMx9bgBJdCYQ6ADkll5WDdwrt8dKJnD0xxX3DB24n2Jfs8NOMYHJlzDuxxWI25UKzb2989jRi3qF99l1O+vVVeOzybcVjGhFmd5Df+4c4mZgNge236zngOFE7xP0cKOhLObyolT8EjJHPjno4dGxmx0Rv2zDzgPlOEIqnyAS0xrBR0L0FpSCXU0kd1u9yw88v/lMGnLov7imZJBlZtuytH6AN4pyN2gxQt2wryU9weSm/t/TI7cA18E8EC1S4I7IsIDQtui8IgF68z3a9WAfMmF5MgJ2qKqZnjJzLFx8+P+P/04jof4e0QgOe6GKXzOqYoz430E1oeWz+p4cNg98I+F/+fUR9/HCX1pxfAXQ4Mvvx16SBBcnaz31PUvmjlQDXe8/5fDLUA/qqr5fxnFXO6VsoLWAAAAAElFTkSuQmCC";
const FONT = "Schibsted Grotesk, system-ui, sans-serif";

export function Cover({ name, genre, size, className = "", label = true, colour }: {
  name: string; genre?: string | null; size?: number; className?: string; label?: boolean;
  colour?: string;  // draw in this colour instead of the genre's (a crate colour being tried)
}) {
  const id = useId().replace(/:/g, "");
  const c = colour ?? coverColor(genre, name);
  const h = hash(name);
  const r = rng(h);
  const kind = h % 4;
  const paper = kind === 1 || kind === 3;  // light card stock; the others are printed dark
  const bg = paper ? shade(c, 0.8) : shade(c, -0.62);
  const shapes: JSX.Element[] = [];
  if (kind === 0) {
    // the name, set big and cropped by the edge of the sleeve
    const words = name.toUpperCase().split(/\s+/).filter(Boolean).slice(0, 3);
    words.forEach((w, i) =>
      shapes.push(<text key={i} x={-3} y={36 + i * 29} fontFamily={FONT} fontWeight={700} fontSize={34}
        letterSpacing={-1.6} fill={i === 0 ? c : shade(c, 0.55)}>{w}</text>));
  } else if (kind === 1) {
    // a record half out of its sleeve
    const cy = 44 + r() * 12;
    shapes.push(<circle key="disc" cx={64} cy={cy} r={38} fill="#0C0F12" />);
    for (let i = 0; i < 4; i++)
      shapes.push(<circle key={"g" + i} cx={64} cy={cy} r={20 + i * 4.5} fill="none" stroke="#252B33" strokeWidth={0.6} />);
    shapes.push(<circle key="lab" cx={64} cy={cy} r={12} fill={c} />);
    shapes.push(<circle key="hole" cx={64} cy={cy} r={1.4} fill={bg} />);
    shapes.push(<rect key="sleeve" x={0} y={0} width={44 + r() * 8} height={100} fill={shade(c, -0.15)} />);
  } else if (kind === 2) {
    // a band of sound across the middle
    const n = 30, w = 88 / n;
    let v = 0.5;
    for (let i = 0; i < n; i++) {
      v = Math.max(0.12, Math.min(1, v + (r() - 0.5) * 0.55));
      const bh = 6 + v * 34;
      shapes.push(<rect key={i} x={6 + i * w} y={56 - bh / 2} width={w * 0.62} height={bh} fill={shade(c, 0.2)} />);
    }
    shapes.push(<rect key="rule" x={6} y={82} width={88} height={0.8} fill={shade(c, 0.2)} opacity={0.7} />);
    shapes.push(<text key="t" x={6} y={92} fontFamily={FONT} fontWeight={600} fontSize={6.5} letterSpacing={0.6}
      fill={shade(c, 0.5)}>{name.toUpperCase().slice(0, 18)}</text>);
  } else {
    // a plain print: one big shape (a sun, a half moon or a block) and two bars
    const form = Math.floor(r() * 3), cx = 34 + r() * 30, cy = 36 + r() * 14, rad = 24 + r() * 8;
    if (form === 0) shapes.push(<circle key="c" cx={cx} cy={cy} r={rad} fill={c} />);
    else if (form === 1) shapes.push(<path key="c" d={`M${cx - rad} ${cy}a${rad} ${rad} 0 0 1 ${rad * 2} 0z`} fill={c} />);
    else shapes.push(<rect key="c" x={cx - rad} y={cy - rad * 0.8} width={rad * 1.6} height={rad * 1.6} fill={c} />);
    shapes.push(<rect key="a" x={0} y={74 + r() * 6} width={100} height={7} fill={shade(c, -0.55)} />);
    shapes.push(<rect key="b" x={0} y={86 + r() * 4} width={100} height={2} fill={shade(c, -0.55)} />);
  }
  return (
    <svg className={`cover ${className}`.trim()} viewBox="0 0 100 100" aria-hidden
      width={size} height={size} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
          <image href={GRAIN} width="16" height="16" />
        </pattern>
      </defs>
      <rect width="100" height="100" fill={bg} />
      {shapes}
      <rect width="100" height="100" fill={`url(#${id})`} opacity={paper ? 0.45 : 0.7} />
      {label && (kind === 1 || kind === 3) && (size == null || size >= 80) &&
        <text x="6" y="96" fontFamily={FONT} fontWeight={600} fontSize="6" letterSpacing="0.4"
          fill={paper ? "#000" : "#fff"} opacity={paper ? 0.5 : 0.55}>
          LC·{String(h % 1000).padStart(3, "0")}
        </text>}
    </svg>
  );
}
