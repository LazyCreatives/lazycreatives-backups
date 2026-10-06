import NumberFlow from "@number-flow/react";

// A count that rolls to its new value digit by digit, like a tape counter, when it
// changes (a backup finishes, a track goes up). SHARED FILE: the same file lives in
// Backups and Uploader (electron/src/components/Rolling.tsx); change both together.
// Slow and smooth on purpose (--ease-glide, a little under --dur-slow x2), and it
// simply swaps the number when the computer asks for reduced motion.
const GLIDE = "cubic-bezier(0.16, 1, 0.3, 1)";
const TIMING = { duration: 750, easing: GLIDE };

export function Rolling({ value, className }: { value: number; className?: string }) {
  return (
    <NumberFlow value={value} className={`rolling ${className ?? ""}`.trim()} willChange
      transformTiming={TIMING} spinTiming={TIMING} opacityTiming={{ duration: 350, easing: "ease-out" }} />
  );
}
