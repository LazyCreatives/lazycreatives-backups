import { describe, it, expect } from "vitest";
import { reduceProgress, initialProgress } from "../src/useProgress";

describe("reduceProgress", () => {
  it("tracks backup counts and completion across a run", () => {
    let s = initialProgress();
    s = reduceProgress(s, { type: "backup_start", project_count: 2, timestamp: "t" });
    expect(s.backup.total).toBe(2);
    expect(s.backup.active).toBe(true);
    expect(s.backup.done).toBe(false);
    s = reduceProgress(s, { type: "project_start", index: 0, project_name: "A", total: 2 });
    expect(s.backup.current).toBe("A");
    s = reduceProgress(s, { type: "project_done", index: 0, project_name: "A", file_count: 3, missing_count: 0 });
    expect(s.backup.completed).toBe(1);
    s = reduceProgress(s, { type: "project_skipped", index: 2, project_name: "C" });
    expect(s.backup.skipped).toBe(1);
    s = reduceProgress(s, { type: "project_error", index: 1, project_name: "B", error: "x" });
    expect(s.backup.errors).toBe(1);
    s = reduceProgress(s, { type: "backup_done", ok_count: 1, error_count: 1, skipped_count: 1 });
    expect(s.backup.active).toBe(false);
    expect(s.backup.done).toBe(true);
    expect(s.backup.log.length).toBeGreaterThanOrEqual(4);
  });

  it("shows a preparing state before counts arrive", () => {
    let s = initialProgress();
    s = reduceProgress(s, { type: "backup_preparing" });
    expect(s.backup.active).toBe(true);
    expect(s.backup.preparing).toBe(true);
    s = reduceProgress(s, { type: "backup_start", project_count: 3, timestamp: "t" });
    expect(s.backup.preparing).toBe(false);
    expect(s.backup.total).toBe(3);
  });

  it("tracks live scan progress", () => {
    let s = initialProgress();
    s = reduceProgress(s, { type: "scan_start", total: 3 });
    expect(s.scan.active).toBe(true);
    expect(s.scan.total).toBe(3);
    s = reduceProgress(s, { type: "scan_progress", done: 2, total: 3, name: "Song" });
    expect(s.scan.done).toBe(2);
    expect(s.scan.current).toBe("Song");
    s = reduceProgress(s, { type: "scan_done", count: 3 });
    expect(s.scan.active).toBe(false);
  });
});
