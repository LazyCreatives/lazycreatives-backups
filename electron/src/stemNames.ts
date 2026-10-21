// Short names for the strips on the Stems desk. Stems from one song often share most
// of their name ("Song - Kick 001 (Final Bounce)", "Song - Snare 002 (Final Bounce)"),
// and a narrow strip then shows the same first words on every one. These drop the
// whole words every stem in the set shares at the start and at the end, so each strip
// shows the part that differs ("Kick 001", "Snare 002"). The full name stays in the
// strip's tooltip and screen-reader label.

// A word with the spaces or underscores after it, so the words join back as they were.
const WORDS = /[^\s_]+[\s_]*/g;
const bare = (w: string) => w.replace(/[\s_]+$/, "");
// Joiners left at either end once the shared words are gone ("- Kick" -> "Kick").
const EDGES = /^[\s\-_–—.,:;·+&|/]+|[\s\-_–—.,:;·+&|/]+$/g;

function tidy(s: string): string {
  let t = s.replace(EDGES, "");
  // a bracket whose other half went with the shared words
  for (const [open, close] of [["(", ")"], ["[", "]"]]) {
    if (t.startsWith(open) && !t.includes(close)) t = t.slice(1);
    if (t.endsWith(close) && !t.includes(open)) t = t.slice(0, -1);
    // or the part that differs sits in brackets on its own: "(Kick)" -> "Kick"
    if (t.startsWith(open) && t.endsWith(close) && t.indexOf(close) === t.length - 1) t = t.slice(1, -1);
  }
  return t.replace(EDGES, "");
}

// Each name without the whole words that every name shares at its start and its end.
// Every name keeps at least one word of its own; one name, or names that are all the
// same, come back as they are.
export function trimShared(names: string[]): string[] {
  const plain = names.map((n) => n.trim());
  if (plain.length < 2 || plain.every((n) => n === plain[0])) return plain;
  const ws = plain.map((n) => n.match(WORDS) ?? []);
  const fewest = Math.min(...ws.map((w) => w.length));
  const first = ws[0];
  let pre = 0;
  while (pre < fewest - 1 && ws.every((w) => bare(w[pre]) === bare(first[pre]))) pre++;
  let suf = 0;
  while (pre + suf < fewest - 1
    && ws.every((w) => bare(w[w.length - 1 - suf]) === bare(first[first.length - 1 - suf]))) suf++;
  return ws.map((w, i) => tidy(w.slice(pre, w.length - suf).join("")) || plain[i]);
}

// A file's name without its extension: "Kick.wav" -> "Kick".
export const withoutExt = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "");

const distinct = (xs: string[]) => new Set(xs).size;

// The label for each stem in a set, in the same order. Starts from the part Backups
// read from each file name ("Kick"); when that reads the same for several stems (the
// part was taken from words they all share), it uses the file names instead.
export function stemLabels(parts: { part: string; name: string }[]): string[] {
  const own = trimShared(parts.map((p) => p.part));
  if (distinct(own) === own.length) return own;
  const fromNames = trimShared(parts.map((p) => withoutExt(p.name)));
  return distinct(fromNames) > distinct(own) ? fromNames : own;
}
