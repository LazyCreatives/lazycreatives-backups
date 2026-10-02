// A song's outline as bars. `peaks` are 0..1; null draws a faint flat line while it
// loads (or when the file can't be read). `played` (0..1) brightens the part heard.
// Same file in Backups and Uploader.
export function Wave({ peaks, color, played = 0, height = 26, onSeek, className = "" }: {
  peaks: number[] | null; color: string; played?: number; height?: number;
  onSeek?: (fraction: number) => void; className?: string;
}) {
  const n = peaks?.length ?? 0;
  return (
    <svg className={`wave ${className}`.trim()} viewBox={`0 0 ${Math.max(n, 1)} 100`} preserveAspectRatio="none"
      height={height} aria-hidden={!onSeek} role={onSeek ? "slider" : undefined}
      aria-label={onSeek ? "Position in the song" : undefined}
      aria-valuenow={onSeek ? Math.round(played * 100) : undefined}
      style={{ cursor: onSeek ? "pointer" : undefined }}
      onClick={onSeek ? (e) => {
        const b = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)));
      } : undefined}>
      {!peaks
        ? <rect x="0" y="49" width="1" height="2" fill={color} opacity="0.25" />
        : peaks.map((v, i) => {
            const h = Math.max(4, v * 100);
            return <rect key={i} x={i + 0.15} y={(100 - h) / 2} width={0.7} height={h} rx={0.2}
              fill={color} opacity={played ? (i / n < played ? 1 : 0.35) : 0.85} />;
          })}
    </svg>
  );
}
