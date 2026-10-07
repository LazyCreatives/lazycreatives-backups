import { describe, it, expect } from "vitest";
// reportText.js builds the problem report (CommonJS, no electron import).
// @ts-ignore - untyped JS module imported for its runtime behaviour
import * as reportText from "../electron/reportText";
// @ts-ignore - the preload script read as plain text
import preload from "../electron/preload.js?raw";

const { scrub, computerLabel, reportUrl, MAX_DETAIL } = reportText as any;

const body = (url: string) => new URL(url).searchParams.get("body") || "";
const title = (url: string) => new URL(url).searchParams.get("title");

describe("problem report", () => {
  it("never carries the home folder, email addresses or keys", () => {
    const t = scrub(
      "Error at /Users/robert/Music/Song.als\nC:\\Users\\robert\\AppData\\x.js\nmail rob@example.com token=abc123 password: hunter2\nhttp://x/cb?code=SECRET&state=1",
      "/Users/robert");
    expect(t).not.toMatch(/robert/);
    expect(t).not.toMatch(/rob@example\.com|abc123|hunter2|SECRET/);
    expect(t).toContain("~/Music/Song.als");
  });

  it("keeps exit codes readable", () => {
    expect(scrub("The engine stopped (exit code 1).", "/home/x")).toContain("exit code 1");
  });

  it("cuts very long details short", () => {
    expect(scrub("x".repeat(MAX_DETAIL + 500), "").length).toBeLessThan(MAX_DETAIL + 50);
  });

  it("names the computer plainly", () => {
    expect(computerLabel("darwin", "15.1.0", "arm64")).toBe("macOS 15.1.0 (Apple Silicon)");
    expect(computerLabel("win32", "10.0.22631", "x64")).toBe("Windows 10.0.22631 (64-bit)");
  });

  it("opens the app's own public report form with version and computer filled in", () => {
    const url = reportUrl({ repo: "lazycreatives-uploader", appName: "LazyCreatives Uploader", version: "0.2.7", computer: "Linux 6.8 (64-bit)", crash: null });
    expect(url.startsWith("https://github.com/LazyCreatives/lazycreatives-uploader/issues/new?")).toBe(true);
    expect(body(url)).toContain("App: LazyCreatives Uploader 0.2.7");
    expect(body(url)).toContain("Computer: Linux 6.8 (64-bit)");
    expect(title(url)).toBeNull();
  });

  it("adds what went wrong after a crash, and stays a sensible length", () => {
    const crash = { kind: "engine", detail: "The engine stopped (exit code 1).\n" + "y".repeat(MAX_DETAIL), at: "2026-10-07T22:00:00.000Z" };
    const url = reportUrl({ repo: "lazycreatives-backups", appName: "LazyCreatives Backups", version: "0.2.4", computer: "macOS 15 (Apple Silicon)", crash });
    expect(title(url)).toBe("Crash: The engine stopped (exit code 1).");
    expect(body(url)).toContain("Problem: the engine stopped unexpectedly, 2026-10-07 22:00 UTC");
    expect(url.length).toBeLessThan(8000);
  });

  it("words the crash message naturally", () => {
    const { crashHeadline } = reportText as any;
    expect(crashHeadline("LazyCreatives Backups", { kind: "engine" })).toBe("LazyCreatives Backups' engine stopped unexpectedly");
    expect(crashHeadline("LazyCreatives Uploader", { kind: "window" })).toBe("LazyCreatives Uploader's window stopped working");
    expect(crashHeadline("LazyCreatives Uploader", { kind: "sudden" })).toBe("LazyCreatives Uploader closed suddenly");
  });

  it("lets the page open the report", () => {
    expect(preload as string).toMatch(/reportProblem:/);
  });
});
