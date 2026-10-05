import { describe, it, expect } from "vitest";
import { describeUpdate } from "../src/components/UpdateCheck";

describe("Check for updates row", () => {
  it("says up to date and offers another check", () => {
    const d = describeUpdate({ current: "0.1.7", state: "latest" });
    expect(d.text).toBe("You're up to date");
    expect(d.button).toBe("check");
  });

  it("offers Restart now once a download is ready (Windows, Linux)", () => {
    const d = describeUpdate({ current: "0.1.6", state: "ready", latest: "0.1.7", action: "restart" });
    expect(d.text).toBe("0.1.7 is ready to install");
    expect(d.button).toBe("restart");
    expect(d.note).toContain("not your computer");
  });

  it("offers the download page when the app can't replace itself (Mac)", () => {
    const d = describeUpdate({ current: "0.1.6", state: "available", latest: "0.1.7", action: "download" });
    expect(d.text).toBe("0.1.7 is available");
    expect(d.button).toBe("download");
  });

  it("shows progress while downloading and no button while busy", () => {
    expect(describeUpdate({ current: "0.1.6", state: "downloading", latest: "0.1.7", percent: 42 }))
      .toMatchObject({ text: "0.1.7 is available, downloading (42%)", button: null });
    expect(describeUpdate({ current: "0.1.6", state: "checking" }).button).toBeNull();
  });

  it("shows a plain error and lets them try again", () => {
    const d = describeUpdate({ current: "0.1.6", state: "error", message: "Couldn't reach the update server." });
    expect(d).toMatchObject({ tone: "error", text: "Couldn't reach the update server.", button: "check" });
  });
});
