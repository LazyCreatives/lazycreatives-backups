import type { UnmatchedSong } from "./types";

// Grouping for "Songs not matched yet" (screens/UnmatchedSongs.tsx).

export const extOf = (p: string) => (p.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toUpperCase().replace("AIFF", "AIF");
const LOSSLESS = new Set(["WAV", "AIF", "FLAC"]);
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "").toLowerCase();

// One row per song. Files are the same song when they share a name and either sit in
// the same folder (the AIF and the MP3 of one render) or are the very same size (a
// copy of it in another folder). Two different "Master.wav" in two song folders are
// two songs, so they get a row each and Link never ties both to one project.
export type Group = { key: string; name: string; files: UnmatchedSong[]; main: UnmatchedSong };
export function groupSongs(list: UnmatchedSong[]): Group[] {
  const groups: { key: string; name: string; files: UnmatchedSong[] }[] = [];
  const byName = new Map<string, typeof groups>();
  for (const s of list) {
    const name = s.name.trim().toLowerCase();
    const same = byName.get(name) ?? [];
    const dir = dirOf(s.path);
    const g = same.find((x) => x.files.some((f) =>
      dirOf(f.path) === dir || (s.size != null && s.size > 0 && f.size === s.size)));
    if (g) { g.files.push(s); continue; }
    const fresh = { key: `${name}\u0000${dir}`, name, files: [s] };
    groups.push(fresh);
    byName.set(name, [...same, fresh]);
  }
  return groups.map(({ key, files }) => {
    const main = [...files].sort((a, b) => Number(b.exists) - Number(a.exists)
      || Number(LOSSLESS.has(extOf(b.path))) - Number(LOSSLESS.has(extOf(a.path)))
      || (b.mtime ?? 0) - (a.mtime ?? 0))[0];
    return { key, name: main.name, files, main };
  });
}
