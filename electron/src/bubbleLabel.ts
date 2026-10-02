/** The name inside a bubble: up to two lines that fit the circle, broken between
 *  words where possible, with "…" only when even two lines can't hold it. Tiny
 *  bubbles get no label (the tooltip still names them). */
export function bubbleLabel(name: string, r: number): string[] {
  const CHAR = 6.0;                       // average width of an 11px character
  const lineChars = (y: number) => Math.floor((2 * Math.sqrt(Math.max(0, r * r - y * y)) * 0.86) / CHAR);
  const one = lineChars(0);
  if (one < 4) return [];
  if (name.length <= one) return [name];
  const per = lineChars(8);               // two lines sit ~8px above and below the middle
  if (per < 4) return [name.slice(0, one - 1).trimEnd() + "…"];
  const words = name.split(/\s+/);
  let first = "";
  while (words.length && (first ? first.length + 1 + words[0].length : words[0].length) <= per) {
    first = first ? `${first} ${words.shift()}` : words.shift()!;
  }
  // The first word alone is too wide for a line: one shortened line reads better
  // than a word chopped in two ("Moonr / ise").
  if (!first) return [name.slice(0, one - 1).trimEnd() + "…"];
  let second = words.join(" ");
  if (second.length > per) second = second.slice(0, per - 1).trimEnd() + "…";
  return second ? [first, second] : [first];
}
