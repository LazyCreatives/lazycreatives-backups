import { describe, it, expect } from "vitest";
import { defaultPic, resolveCover, type CoverState } from "../src/coverArt";

const pic = (id: string, extra: Partial<CoverState["pictures"][number]> = {}) =>
  ({ id, name: id, use: "background" as const, genres: [], main: false, w: 100, h: 50, url: `/api/covers/img/${id}`, ...extra });

const base: CoverState = {
  rule: "genre", style: "ink", projects: {},
  pictures: [pic("night", { genres: ["House", "Techno"] }), pic("sunset", { main: true }), pic("moth", { use: "full" })],
};

describe("cover pictures", () => {
  it("draws every cover when no pictures are saved", () => {
    expect(resolveCover({ ...base, pictures: [] }, "Afterglow", "House")).toBeNull();
  });
  it("gives a genre its pictures, and everything else the main one", () => {
    expect(defaultPic(base, "Afterglow", "house")?.id).toBe("night");
    expect(defaultPic(base, "Amen", "Boom bap")?.id).toBe("sunset");
  });
  it("never hands out a picture that is only for when it's picked", () => {
    const s = { ...base, rule: "mix" as const };
    for (const n of ["a", "b", "c", "d", "e", "f", "g"]) expect(defaultPic(s, n, null)?.id).not.toBe("moth");
    expect(defaultPic({ ...base, rule: "one" }, "x", "House")?.id).toBe("sunset");
  });
  it("uses a project's own pick, its use, style and crop", () => {
    const s = { ...base, projects: { Afterglow: { pic: "moth", style: "strip" as const, fx: 0.2, fy: 1 } } };
    const a = resolveCover(s, "Afterglow", "House")!;
    expect([a.pic, a.use, a.style, a.fx, a.fy]).toEqual(["moth", "full", "strip", 0.2, 1]);
  });
  it("keeps the drawn cover when it was picked on purpose", () => {
    expect(resolveCover({ ...base, projects: { Afterglow: { pic: null } } }, "Afterglow", "House")).toBeNull();
  });
  it("follows a pick made in Backups when Uploader has none", () => {
    const s = { ...base, backups: { pictures: [pic("b1")], projects: { Afterglow: { pic: "b1" } } } };
    expect(resolveCover(s, "Afterglow", "House")?.pic).toBe("b1");
    expect(resolveCover({ ...s, projects: { Afterglow: { pic: "sunset" } } }, "Afterglow", "House")?.pic).toBe("sunset");
  });
});
