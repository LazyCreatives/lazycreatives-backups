// Albums (shared with Backups): the words and numbers on the Albums pages.
import { describe, expect, it } from "vitest";
import { albumState, daysToGo, fadeLabel, moveItem, readyCount, type Album, type AlbumSong } from "../src/albums";

const song = (title: string, ready: boolean): AlbumSong => ({
  path: `/m/${title}.wav`, title, project: "", project_id: null, backup: null, gapless_after: false,
  ready: null, needs: ready ? [] : ["Needs a WAV"], is_ready: ready,
});
const album = (songs: AlbumSong[]): Album => ({ id: "a", title: "Night Drive", release_date: "", crossfade: 0, songs, created_at: 0, updated_at: 0 });

describe("albums", () => {
  it("counts down to release day in plain words", () => {
    const now = new Date(2026, 9, 7, 23, 0);
    expect(daysToGo("2026-11-14", now)).toBe("38 days to go");
    expect(daysToGo("2026-10-08", now)).toBe("Out tomorrow");
    expect(daysToGo("2026-10-07", now)).toBe("Out today");
    expect(daysToGo("2026-10-04", now)).toBe("Came out 3 days ago");
    expect(daysToGo("", now)).toBe("");
  });

  it("says what is left to sort", () => {
    expect(albumState(album([]))).toEqual({ label: "No songs yet", tone: "quiet" });
    const a = album([song("Low Beams", true), song("Glovebox", false)]);
    expect(readyCount(a)).toBe(1);
    expect(albumState(a)).toEqual({ label: "1 to sort", tone: "warn" });
    expect(albumState(album([song("Low Beams", true)])).label).toBe("Ready");
  });

  it("names the crossfade and moves songs", () => {
    expect(fadeLabel(0)).toBe("Off");
    expect(fadeLabel(6)).toBe("6 s");
    expect(fadeLabel(2.5)).toBe("2.5 s");
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});
