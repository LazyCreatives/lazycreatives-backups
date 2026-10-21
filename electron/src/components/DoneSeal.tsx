// The small seal a project's status wears for a moment when its backup has just
// finished and checked out: a green disc presses in and the tick draws itself. A quiet
// cousin of the big verified seal (VerifiedSeal), calm because it shows on every row
// backed up. Used by the Library rows, Home's Changed cards and the backup screen.
// Styles are in library.css (.doneseal).
export function DoneSeal({ size = 14 }: { size?: number }) {
  return (
    <svg className="doneseal" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle className="doneseal__disc" cx="8" cy="8" r="7" />
      <path className="doneseal__tick" d="M4.6 8.3 l2.3 2.3 l4.5 -4.9" />
    </svg>
  );
}
