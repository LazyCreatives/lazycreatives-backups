// Forgiving search for the Library: typos, missing letters and half-typed words
// still find the project. Small on purpose — no search library needed for a few
// hundred names.

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Edit distance with an early exit once it can't get under `max`.
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const swap = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? (prev[j - 2] ?? 0) : Infinity;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), swap);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// How many typos a typed word of this length may carry.
function allowance(len: number): number {
  return len <= 3 ? 0 : len <= 6 ? 1 : 2;
}

// Score one typed word against the words of a name (higher is better, 0 = no match).
function wordScore(q: string, words: string[], joined: string): number {
  let best = 0;
  for (const w of words) {
    if (w === q) return 100;
    if (w.startsWith(q)) best = Math.max(best, 80);
    else if (w.includes(q)) best = Math.max(best, 60);
    else {
      const max = allowance(q.length);
      if (max > 0) {
        // compare against the whole word and against its start (for half-typed words)
        const d = Math.min(distance(q, w, max), distance(q, w.slice(0, q.length), max));
        if (d <= max) best = Math.max(best, 50 - d * 10);
      }
    }
  }
  if (best === 0 && q.length >= 3 && joined.replace(/ /g, "").includes(q)) best = 55; // "deepcut" finds "Deep Cut"
  return best;
}

/** Score `query` against the given texts. 0 means no match; every typed word must hit something. */
export function fuzzyScore(query: string, texts: (string | null | undefined)[]): number {
  const q = norm(query);
  if (!q) return 1;
  const joined = norm(texts.filter(Boolean).join(" "));
  const words = joined.split(" ").filter(Boolean);
  let total = 0;
  for (const part of q.split(" ")) {
    const s = wordScore(part, words, joined);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}
