import { describe, expect, it, vi } from "vitest";
import type { Album, AlbumSong } from "./albums";

// A tiny album engine: just enough of the real rules (add appends, order sorts,
// a song change sets its flags) to see what Undo leaves behind.
const engine = vi.hoisted(() => ({ album: null as any }));
vi.mock("./api", () => {
  const song = (path: string, title = path) => ({ path, title, project: "", project_id: null, backup: null,
    gapless_after: false, ready: null, needs: [], is_ready: false });
  const out = () => JSON.parse(JSON.stringify(engine.album));
  return {
    makeApi: () => ({
      albumsRev: async () => ({ rev: 1 }),
      listAlbums: async () => ({ rev: 1, albums: [out()] }),
      addAlbumSongs: async (_id: string, songs: { path: string; title?: string }[]) => {
        for (const s of songs) engine.album.songs.push(song(s.path, s.title)); return out();
      },
      orderAlbum: async (_id: string, paths: string[]) => {
        engine.album.songs = paths.map((p: string) => engine.album.songs.find((s: any) => s.path === p)); return out();
      },
      changeAlbumSong: async (_id: string, c: any) => {
        const s = engine.album.songs.find((x: any) => x.path === c.path);
        if (c.gapless_after !== undefined) s.gapless_after = c.gapless_after;
        if (c.ready !== undefined) { s.ready = c.ready; s.is_ready = c.ready; }
        return out();
      },
      removeAlbumSong: async (_id: string, path: string) => {
        engine.album.songs = engine.album.songs.filter((s: any) => s.path !== path); return out();
      },
    }),
  };
});

describe("Undo after taking a song off an album", () => {
  it("puts it back in its old place with its ticks", async () => {
    const { putBack, takeOut } = await import("./albums");
    const mk = (path: string, extra: Partial<AlbumSong> = {}): AlbumSong => ({ path, title: path, project: "", project_id: null,
      backup: null, gapless_after: false, ready: null, needs: [], is_ready: false, ...extra });
    engine.album = { id: "a1", title: "Night", release_date: "", crossfade: 0,
      songs: [mk("a.wav"), mk("b.wav", { ready: true, is_ready: true, gapless_after: true }), mk("c.wav")] } as Album;
    const order = engine.album.songs.map((s: AlbumSong) => s.path);
    const removed = engine.album.songs[1];
    await takeOut("a1", "b.wav");
    const after = await putBack("a1", removed, order);
    expect(after.songs.map((s) => s.path)).toEqual(["a.wav", "b.wav", "c.wav"]);
    expect(after.songs[1].ready).toBe(true);
    expect(after.songs[1].gapless_after).toBe(true);
  });
});

describe("release day and the album's colour", () => {
  it("knows when release day is", async () => {
    const { releaseDay } = await import("./albums");
    const now = new Date(2026, 9, 8, 18, 30);
    expect(releaseDay("2026-10-09", now)).toBe(1);
    expect(releaseDay("2026-10-08", now)).toBe(0);
    expect(releaseDay("2026-10-01", now)).toBe(-1);
    expect(releaseDay("", now)).toBe(null);
  });

  it("takes the genre most songs share, none when no song has one", async () => {
    const { mainGenre } = await import("./albums");
    const a = (genres: (string | undefined)[]) => ({ songs: genres.map((genre, i) => ({ path: `${i}.wav`, genre })) }) as Album;
    expect(mainGenre(a(["House", "Techno", "Techno", undefined]))).toBe("Techno");
    expect(mainGenre(a(["Dub", "Grime"]))).toBe("Dub");
    expect(mainGenre(a([undefined, ""]))).toBe("");
    expect(mainGenre(a([]))).toBe("");
  });
});
