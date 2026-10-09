import { describe, expect, it } from "vitest";
import { groupSongs } from "./unmatched";
import type { UnmatchedSong } from "./types";

const song = (path: string, size: number | null = 1000): UnmatchedSong => ({
  path, name: path.split("/").pop()!.replace(/\.[^.]+$/, ""), size, mtime: 1, kind: "song",
  suggest_id: null, suggest_why: null, exists: true,
});

describe("one row per song on Songs not matched yet", () => {
  it("keeps the AIF and the MP3 of one render together", () => {
    const g = groupSongs([song("/Ex/Night Drive/Night Drive.aif", 5000), song("/Ex/Night Drive/Night Drive.mp3", 900)]);
    expect(g).toHaveLength(1);
    expect(g[0].files).toHaveLength(2);
    expect(g[0].main.path).toMatch(/\.aif$/);
  });
  it("keeps a copy of the same file in another folder together", () => {
    const g = groupSongs([song("/Ex/A/Song.wav", 4321), song("/Backup/Song.wav", 4321)]);
    expect(g).toHaveLength(1);
  });
  it("gives two different songs with the same name a row each", () => {
    const g = groupSongs([song("/Ex/Night Drive/Master.wav", 5000), song("/Ex/Sunrise/Master.wav", 7000)]);
    expect(g).toHaveLength(2);
    expect(new Set(g.map((x) => x.key)).size).toBe(2);
  });
});
