import { describe, it, expect } from "vitest";
// notes.js is CommonJS with no electron import, shared by the updater and these tests.
// @ts-ignore - untyped JS module imported for its runtime behaviour
import * as notesModule from "../electron/notes";
import { shouldShow } from "../src/components/WhatsNew";

const { changelogSection, releaseSection, parseNotes, notesText } = notesModule as any;

const CHANGELOG = `# What's new

<!--
## 9.9.9 is only an example in a comment
-->

## Unreleased

## 0.1.8 (4 October 2026)

### New
- **What's new after an update.** The app shows a short list the first time it opens.
- A plain line with no bold title.

### Better
- **Two looks.** Pick one:
  - **Crate** looks like a DJ library.
  - **Sleeve** looks like a record shop.

### Fixed
- Samples on \\\\\\\\PC-NAME\\\\Users no longer show as missing.

## 0.1.7 (3 October 2026)

### New
- **Search.** Older notes.
`;

describe("what's new notes", () => {
  it("reads one version's section of the changelog", () => {
    const groups = parseNotes(changelogSection(CHANGELOG, "0.1.8"));
    expect(groups.map((g: any) => g.kind)).toEqual(["New", "Better", "Fixed"]);
    expect(groups[0].items[0]).toEqual({
      title: "What's new after an update.",
      detail: "The app shows a short list the first time it opens.",
    });
    expect(groups[0].items[1]).toEqual({ title: "A plain line with no bold title.", detail: "" });
  });

  it("folds sub-points into their bullet and undoes markdown escapes", () => {
    const groups = parseNotes(changelogSection(CHANGELOG, "v0.1.8"));
    expect(groups[1].items).toHaveLength(1);
    expect(groups[1].items[0].detail).toBe("Pick one: **Crate** looks like a DJ library. **Sleeve** looks like a record shop.");
    expect(groups[2].items[0].title).toBe("Samples on \\\\PC-NAME\\Users no longer show as missing.");
  });

  it("has nothing for a version with no notes, or an empty Unreleased", () => {
    expect(parseNotes(changelogSection(CHANGELOG, "0.2.0"))).toEqual([]);
    expect(parseNotes(changelogSection(CHANGELOG, "Unreleased"))).toEqual([]);
  });

  it("reads the What's new part of a release page and stops at the rule", () => {
    const body = "## What's new\r\n\r\n### Fixed\r\n- **A fix.** Detail.\r\n\r\n---\r\n\r\nUnsigned beta build. See docs.\r\n";
    expect(parseNotes(releaseSection(body))).toEqual([{ kind: "Fixed", items: [{ title: "A fix.", detail: "Detail." }] }]);
    expect(parseNotes(releaseSection("Unsigned beta build."))).toEqual([]);
    expect(parseNotes(releaseSection(undefined))).toEqual([]);
  });

  it("writes a short list for the update message box", () => {
    const text = notesText(parseNotes(changelogSection(CHANGELOG, "0.1.8")), 3);
    expect(text).toBe([
      "New", "•  What's new after an update.", "•  A plain line with no bold title.",
      "", "Better", "•  Two looks.",
      "", "…and 1 more.",
    ].join("\n"));
  });
});

describe("when the What's new panel opens by itself", () => {
  it("opens after an update", () => expect(shouldShow("0.1.8", "0.1.7", true)).toBe(true));
  it("stays shut once seen", () => expect(shouldShow("0.1.8", "0.1.8", true)).toBe(false));
  it("opens for someone updating from a version before the panel existed", () =>
    expect(shouldShow("0.1.8", null, true)).toBe(true));
  it("stays shut on a fresh install", () => expect(shouldShow("0.1.8", null, false)).toBe(false));
});

describe("note titles", () => {
  it("only uses bold words as the title when they end a sentence", () => {
    const g = parseNotes("### New\n- **Cover art for every project**, drawn from its name.\n- **Done.** Detail.");
    expect(g[0].items[0]).toEqual({ title: "Cover art for every project, drawn from its name.", detail: "" });
    expect(g[0].items[1]).toEqual({ title: "Done.", detail: "Detail." });
  });
});
