// A song's outline as bars. `peaks` are 0..1; null draws a faint flat line while it
// loads (or when the file can't be read). `played` (0..1) brightens the part heard.
// With `duration` (the player bar) it is also a keyboard slider: Left/Right move 5 s,
// Home/End jump to the start or end. Pointing at a wave you can seek shows a thin line
// where it would jump to (with the time, when the length is known), and dragging scrubs.
// `marks` pin moments to the wave: a project's markers (cues, named) or listeners'
// comments (dots); clicking one jumps there when the wave can seek.
// Same file in Backups and Uploader.
import { useRef, useState } from "react";

export interface WaveMark {
  at: number;            // 0..1 along the song
  label: string;         // a marker's name, or the comment itself
  who?: string;          // who left a comment
  time?: number;         // seconds, shown beside it
  kind?: "cue" | "comment";
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function Wave({ peaks, color, played = 0, height = 26, onSeek, duration, className = "", marks }: {
  peaks: number[] | null; color: string; played?: number; height?: number;
  onSeek?: (fraction: number) => void; duration?: number; className?: string; marks?: WaveMark[];
}) {
  const n = peaks?.length ?? 0;
  const keys = !!onSeek && !!duration && duration > 0;
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);
  const at = (e: { clientX: number; currentTarget: Element }) => {
    const b = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
  };
  const svg = (
    <svg className={`wave ${className}`.trim()} viewBox={`0 0 ${Math.max(n, 1)} 100`} preserveAspectRatio="none"
      height={height} aria-hidden={!onSeek} role={onSeek ? "slider" : undefined}
      aria-label={onSeek ? "Position in the song" : undefined}
      aria-valuenow={onSeek ? Math.round(played * 100) : undefined}
      aria-valuemin={onSeek ? 0 : undefined} aria-valuemax={onSeek ? 100 : undefined}
      aria-valuetext={keys ? `${mmss(played * duration!)} of ${mmss(duration!)}` : undefined}
      tabIndex={keys ? 0 : undefined}
      onKeyDown={keys ? (e) => {
        const step = 5 / duration!;
        const to = e.key === "ArrowRight" ? played + step : e.key === "ArrowLeft" ? played - step
          : e.key === "Home" ? 0 : e.key === "End" ? 0.999 : null;
        if (to === null) return;
        e.preventDefault();
        onSeek!(Math.min(1, Math.max(0, to)));
      } : undefined}
      style={{ cursor: onSeek ? "pointer" : undefined, touchAction: onSeek ? "none" : undefined }}
      onPointerDown={onSeek ? (e) => {
        if (e.button !== 0) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onSeek(at(e));
      } : undefined}
      onPointerMove={onSeek ? (e) => {
        const f = at(e);
        setHover(f);
        if (dragging.current) onSeek(f);
      } : undefined}
      onPointerUp={onSeek ? () => { dragging.current = false; } : undefined}
      onPointerLeave={onSeek ? () => { if (!dragging.current) setHover(null); } : undefined}>
      {!peaks
        ? <rect x="0" y="49" width="1" height="2" fill={color} opacity="0.25" />
        : peaks.map((v, i) => {
            const h = Math.max(4, v * 100);
            return <rect key={i} x={i + 0.15} y={(100 - h) / 2} width={0.7} height={h} rx={0.2}
              fill={color} opacity={played ? (i / n < played ? 1 : 0.35) : 0.85} />;
          })}
      {hover !== null && <rect className="wave__cursor" x={hover * Math.max(n, 1) - 0.15} y="0" width="0.3" height="100" />}
    </svg>
  );
  const pins = !!marks?.length && (
    <span className="wave__marks">
      {marks.map((m, i) => {
        const when = m.time != null ? mmss(m.time) : "";
        const say = m.kind === "comment" ? `${m.who ? `${m.who}: ` : ""}${m.label}` : m.label || "Marker";
        const Tag = onSeek ? "button" : "span";
        return (
          <Tag key={i} type={onSeek ? "button" : undefined} className={`wave__mark wave__mark--${m.kind ?? "cue"}`}
            style={{ left: `${Math.min(100, Math.max(0, m.at * 100))}%` }}
            title={`${when ? `${when} · ` : ""}${say}`}
            aria-label={onSeek ? `Jump to ${when ? `${when}, ` : ""}${say}` : undefined}
            onClick={onSeek ? (e: React.MouseEvent) => { e.stopPropagation(); onSeek(m.at); } : undefined}>
            {m.kind !== "comment" && m.label && <em>{m.label}</em>}
          </Tag>
        );
      })}
    </span>
  );
  if (!onSeek && !pins) return svg;
  return (
    <span className={`wave-wrap${pins ? " wave-wrap--marked" : ""}`}>
      {svg}
      {pins}
      {hover !== null && !!duration && duration > 0 &&
        <span className="wave__time" style={{ left: `${hover * 100}%` }}>{mmss(hover * duration)}</span>}
    </span>
  );
}
