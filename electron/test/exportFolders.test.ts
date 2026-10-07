import { describe, expect, it } from "vitest";
import { exportFolderRows } from "../src/exportFolders";

describe("exportFolderRows", () => {
  it("lists yours, then found, then Uploader's, each folder once", () => {
    const rows = exportFolderRows({
      folders: ["/m/WAVS"],
      found_folders: ["/m/Bounces", "/m/WAVS"],
      uploader_folders: ["/m/Bounces", "/u/Exports"],
    });
    expect(rows).toEqual([
      { path: "/m/WAVS", kind: "mine" },
      { path: "/m/Bounces", kind: "found" },
      { path: "/u/Exports", kind: "uploader" },
    ]);
  });
  it("is empty before the list has loaded", () => {
    expect(exportFolderRows(null)).toEqual([]);
  });
});
