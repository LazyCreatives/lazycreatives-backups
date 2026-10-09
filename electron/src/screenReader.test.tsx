// @vitest-environment jsdom
// What a screen reader says for the Settings tab row, read with a virtual screen reader
// (@guidepup/virtual-screen-reader, MIT) in jsdom: each tab is announced by its name, its
// role and whether it is the open one, and the row as a whole carries its label.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { virtual } from "@guidepup/virtual-screen-reader";
import { afterEach, describe, expect, it } from "vitest";
import { SetTabs } from "./components/SetRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no CSS.escape, which the screen reader uses to follow aria-controls ids.
const g = globalThis as { CSS?: { escape?: (s: string) => string } };
g.CSS ??= {};
g.CSS.escape ??= (s) => s.replace(/[^\w-]/g, (c) => `\\${c}`);

const TABS = [["general", "General"], ["look", "Look"]] as const;
let root: Root | undefined;

afterEach(async () => {
  await virtual.stop();
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

describe("screen reader: settings tabs", () => {
  it("reads every tab by name, with its role and which one is open", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() => root!.render(<SetTabs tabs={TABS} value="general" onChange={() => {}} />));

    await virtual.start({ container: host });
    for (let i = 0; i < 3; i++) await virtual.next();

    expect(await virtual.spokenPhraseLog()).toEqual([
      "tablist, Settings, orientated horizontally",
      "tab, General, selected, position 1, set size 2",
      "tab, Look, not selected, position 2, set size 2",
      "end of tablist, Settings, orientated horizontally",
    ]);
  });
});
