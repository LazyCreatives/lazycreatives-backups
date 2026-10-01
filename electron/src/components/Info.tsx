// A small "ⓘ" that reveals a plain-English explainer on hover/focus. Pure CSS
// tooltip (see .info in theme.css). Use it to demystify any stat or option.
export function Info({ text, side = "top" }: { text: string; side?: "top" | "left" }) {
  return (
    <span className={`info info--${side}`} tabIndex={0} role="note" aria-label={text} data-tip={text}>
      i
    </span>
  );
}
