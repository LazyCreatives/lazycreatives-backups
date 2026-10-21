import { describe, expect, it } from "vitest";
import { initialProgress, reduceProgress, runDoneCount, runDoneTitle, runPct } from "./useProgress";

describe("backup progress counting", () => {
  it("counts backed up, already safe and failed projects alike", () => {
    expect(runDoneCount({ completed: 3, skipped: 300, errors: 1 })).toBe(304);
    expect(runPct({ total: 304, completed: 3, skipped: 300, errors: 1 })).toBe(100);
  });
  it("is not stuck near the start when most projects are unchanged", () => {
    expect(runPct({ total: 303, completed: 1, skipped: 150, errors: 0 })).toBe(50);
  });
  it("is 0 before a run knows its size, and never past 100", () => {
    expect(runPct({ total: 0, completed: 0, skipped: 0, errors: 0 })).toBe(0);
    expect(runPct({ total: 2, completed: 2, skipped: 1, errors: 0 })).toBe(100);
  });
  it("follows the live events", () => {
    let s = initialProgress();
    s = reduceProgress(s, { type: "backup_start", project_count: 4 } as any);
    s = reduceProgress(s, { type: "project_skipped", project_name: "A" } as any);
    s = reduceProgress(s, { type: "project_skipped", project_name: "B" } as any);
    s = reduceProgress(s, { type: "project_done", project_name: "C", file_count: 3, missing_count: 0 } as any);
    expect(runPct(s.backup)).toBe(75);
  });
});

describe("Home's line when a backup ends", () => {
  it("says a project with nothing new was checked, not \"backed up 0\"", () => {
    // One Changed card backed up from Home whose contents hadn't changed (only its save time).
    let s = initialProgress();
    s = reduceProgress(s, { type: "backup_start", project_count: 1 } as any);
    s = reduceProgress(s, { type: "project_start", project_name: "Acid Test 303" } as any);
    s = reduceProgress(s, { type: "project_skipped", project_name: "Acid Test 303" } as any);
    s = reduceProgress(s, { type: "backup_done", ok_count: 0, skipped_count: 1, error_count: 0 } as any);
    expect(runDoneTitle(s.backup)).toBe("Checked 1 project. Nothing had changed, so it was already safe.");
    expect(runDoneTitle({ completed: 0, skipped: 3, errors: 0 })).toBe("Checked 3 projects. Nothing had changed, so they were already safe.");
  });
  it("still counts the ones backed up, and failures", () => {
    expect(runDoneTitle({ completed: 1, skipped: 0, errors: 0 })).toBe("Backed up and checked 1 project.");
    expect(runDoneTitle({ completed: 3, skipped: 300, errors: 0 })).toBe("Backed up and checked 3 projects.");
    expect(runDoneTitle({ completed: 2, skipped: 0, errors: 1 })).toBe("Backed up 2, 1 failed.");
  });
});
