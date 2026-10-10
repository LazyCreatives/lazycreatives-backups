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

describe("planning an album", () => {
  it("offers each project's newest proper mixdown first, older and OLD copies behind it", async () => {
    const { groupCandidates } = await import("./albums");
    const c = (title: string, project: string, exported: number) => ({ path: `/x/${title}.wav`, title, project, project_id: project, exported });
    const groups = groupCandidates([c("Conni v2", "conni", 10), c("Conni (OLD)", "conni", 30), c("Conni v3", "conni", 20), c("Loose", "", 5)]);
    expect(groups.map((g) => g.main.title)).toEqual(["Conni v3", "Loose"]);
    expect(groups[0].more.map((s) => s.title)).toEqual(["Conni v2", "Conni (OLD)"]);
  });

  it("calls it a single, EP or album the way Spotify and Apple Music do", async () => {
    const { releaseKind } = await import("./albums");
    expect(releaseKind(2, 600)).toBe("single");
    expect(releaseKind(5, 1500)).toBe("EP");
    expect(releaseKind(5, 1900)).toBe("album");
    expect(releaseKind(7, 900)).toBe("album");
  });

  it("flags a big change of pace, but not half or double time", async () => {
    const { tempoJump } = await import("./albums");
    expect(tempoJump(140, 142)).toBeNull();
    expect(tempoJump(87, 174)).toBeNull();
    expect(tempoJump(126, 174)).toBe(48);
    expect(tempoJump(null, 120)).toBeNull();
  });
});

describe("a newer export of an album song", () => {
  const song = (path: string, project_id = "p1") => ({ path, title: "x", project: "", project_id, backup: null,
    gapless_after: false, ready: null, needs: [], is_ready: true }) as AlbumSong;
  const c = (path: string, exported: number, project_id = "p1") => ({ path, title: path.split("/").pop()!.replace(/\.\w+$/, ""), project: "P", project_id, exported });

  it("knows two files of one song by their name, version words aside", async () => {
    const { sameSong, songWords } = await import("./albums");
    expect(songWords("/m/Night Drive v3 (Master) 2.wav")).toEqual(["night", "drive"]);
    expect(sameSong("/m/PROBLEM CHILD.wav", "/m/Problem Child final v2.wav")).toBe(true);
    expect(sameSong("/m/Psychidelly Ruined Mastered Better I Hope.wav", "/m/PSYCHIDELLY RUINED.wav")).toBe(true);
    expect(sameSong("/m/Night Drive.wav", "/m/Bass Intro Loop.wav")).toBe(false);
  });

  it("offers a real re-export, never a copy, another song, a lossy file or one from the same session", async () => {
    const { newerExport } = await import("./albums");
    const s = song("/m/Night Drive.wav");
    const base = c("/m/Night Drive.wav", 1000);
    expect(newerExport(s, [base, c("/m/Night Drive v2.wav", 5000)])?.path).toBe("/m/Night Drive v2.wav");
    expect(newerExport(s, [base, c("/m/Night Drive v2.wav", 5000), c("/m/Night Drive v3.wav", 9000)])?.path).toBe("/m/Night Drive v3.wav");
    expect(newerExport(s, [base, c("/m/Night Drive.mp3", 5000)])).toBeNull();          // a WAV stays a WAV
    expect(newerExport(s, [base, c("/m/Night Drive v2.wav", 1100)])).toBeNull();       // same session
    expect(newerExport(s, [base, c("/m/Night Drive test.wav", 5000)])).toBeNull();     // a test copy
    expect(newerExport(s, [base, c("/m/Synth Stab.wav", 5000)])).toBeNull();           // another song
    expect(newerExport(s, [base, c("/m/Night Drive v2.wav", 5000, "p2")])).toBeNull(); // another project
    expect(newerExport(s, [c("/m/Night Drive v2.wav", 5000)])).toBeNull();             // its own export unknown
    expect(newerExport(s, [base, c("/m/Night Drive v2.wav", 5000)], new Set(["/m/Night Drive v2.wav"]))).toBeNull(); // already on the album
  });
});
