import { describe, expect, it } from "vitest";
import { DRIVE_GONE, judge, plainReason } from "./runBackup";

describe("plainReason: an unplugged backup drive", () => {
  it("says to plug the drive in, word for word", () => {
    expect(plainReason("Your backup drive isn't connected. Plug it in and try again.")).toBe(DRIVE_GONE);
  });
  it("never blames permissions for a missing drive", () => {
    // what a Mac says when /Volumes/<drive> is gone and a folder can't be made there
    const r = plainReason("Your backup drive isn't connected. Plug it in and try again. [Errno 13] Permission denied: '/Volumes/MyDrive'");
    expect(r).toBe(DRIVE_GONE);
    expect(r).not.toMatch(/allowed/);
  });
  it("a failed project on a drive that went away reads the same", () => {
    const res = judge({ ok_count: 0, error_count: 1, errors: [{ project_name: "Song", path: "/x/Song.als", error: DRIVE_GONE }] } as any, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe(DRIVE_GONE);
  });
  it("still explains real permission problems", () => {
    expect(plainReason("[Errno 13] Permission denied: '/Users/me/x'")).toMatch(/allowed/);
  });
});
