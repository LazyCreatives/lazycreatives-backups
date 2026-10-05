import { describe, expect, it } from "vitest";
import { tildePath } from "../src/components/DestChoices";

describe("tildePath", () => {
  it("shortens a Mac or Linux home folder to ~", () => {
    expect(tildePath("/Users/rob/Dropbox")).toBe("~/Dropbox");
    expect(tildePath("/home/rob/Dropbox/Lazy Creatives Backups")).toBe("~/Dropbox/Lazy Creatives Backups");
  });
  it("shortens a Windows home folder to ~", () => {
    expect(tildePath("C:\\Users\\rob\\Dropbox")).toBe("~\\Dropbox");
  });
  it("names the Mac's hidden cloud folders", () => {
    expect(tildePath("/Users/rob/Library/CloudStorage/GoogleDrive-rob@x.com/My Drive/Lazy Creatives Backups"))
      .toBe("Google Drive/My Drive/Lazy Creatives Backups");
    expect(tildePath("/Users/rob/Library/Mobile Documents/com~apple~CloudDocs")).toBe("iCloud Drive");
    expect(tildePath("/Users/rob/Library/CloudStorage/OneDrive-Personal")).toBe("OneDrive-Personal");
  });
  it("leaves other places alone", () => {
    expect(tildePath("/Volumes/Studio NAS/Backups")).toBe("/Volumes/Studio NAS/Backups");
    expect(tildePath("G:\\My Drive")).toBe("G:\\My Drive");
  });
});
