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
