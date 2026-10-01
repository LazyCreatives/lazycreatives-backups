import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeApi } from "../src/api";

describe("api client", () => {
  beforeEach(() => {
    (globalThis as any).window = { ablebackup: { token: "T", port: "9000" } };
  });

  it("sends the auth token and parses scan results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ projects: [{ name: "Song", present_count: 1, missing_count: 0 }] }),
    });
    (globalThis as any).fetch = fetchMock;
    const api = makeApi();
    const projects = await api.scan(["C:/Music"]);
    expect(projects[0].name).toBe("Song");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:9000/api/scan");
    expect(opts.headers["X-Auth-Token"]).toBe("T");
    expect(JSON.parse(opts.body)).toEqual({ sources: ["C:/Music"], find_missing: false });
  });

  it("throws on non-ok responses", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ detail: "no destination configured" }),
    });
    const api = makeApi();
    await expect(api.startBackup({})).rejects.toThrow(/no destination configured/);
  });
});

describe("exports api", () => {
  beforeEach(() => {
    (globalThis as any).window = { ablebackup: { token: "T&x", port: "9000" } };
  });

  it("builds a player URL with the token in the query", () => {
    const url = makeApi().exportAudioUrl("/Music/WAVS/Night Drive.wav");
    expect(url).toBe("http://127.0.0.1:9000/api/exports/audio?path=%2FMusic%2FWAVS%2FNight%20Drive.wav&t=T%26x");
  });

  it("links a song to a project", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    (globalThis as any).fetch = fetchMock;
    await makeApi().linkExport("/a.wav", "p1");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:9000/api/exports/link");
    expect(JSON.parse(opts.body)).toEqual({ path: "/a.wav", project_id: "p1" });
  });
});
