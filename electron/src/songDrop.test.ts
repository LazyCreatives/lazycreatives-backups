import { describe, expect, it } from "vitest";
import { SONG_FILE, isSongDrag } from "./songDrop";

const drag = (types: string[]) => ({ items: types.map((type) => ({ kind: "file", type })) }) as unknown as DataTransfer;

describe("dropping songs on a project", () => {
  it("knows a song file by its ending", () => {
    for (const f of ["Mix.wav", "a/b/Song.AIFF", "x.aif", "y.flac", "z.mp3", "q.m4a", "o.ogg", "p.opus"]) expect(SONG_FILE.test(f)).toBe(true);
    for (const f of ["Song.als", "notes.txt", "cover.png", "wav"]) expect(SONG_FILE.test(f)).toBe(false);
  });
  it("only treats audio being dragged as a song drag", () => {
    expect(isSongDrag(drag(["audio/wav"]))).toBe(true);
    expect(isSongDrag(drag(["", "audio/mpeg"]))).toBe(true);
    expect(isSongDrag(drag([""]))).toBe(false);
    expect(isSongDrag(drag(["image/png"]))).toBe(false);
    expect(isSongDrag(null)).toBe(false);
  });
});
