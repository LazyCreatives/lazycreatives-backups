// Colour-blind pictures (opt-in: npm run test:colourblind, never part of test:screens).
// Starts the real app with the same made-up library, then takes a plain picture of Home and
// the Library in dark mode, in both looks, as seen with each common kind of colour blindness
// (Chromium's own simulation). Nothing is compared: look at the pictures in
// e2e/colourblind-out/ and check that nothing is told apart by colour alone.
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { closeApp, launchApp, type RunningApp } from "./app";
import { fillLibrary } from "./library";

const OUT = path.join(__dirname, "colourblind-out");
const LOOKS = ["crate", "sleeve"] as const;
const SCREENS = ["home", "library"] as const;
const VISION = ["none", "deuteranopia", "protanopia", "tritanopia"] as const;

let running: RunningApp | undefined;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { running = await launchApp(); });
test.afterAll(async () => { await closeApp(running); });

// Open the app on `tab` in `look`, dark (the same localStorage keys as screens.spec.ts).
async function open(look: string, tab: string): Promise<Page> {
  const { page, version } = running!;
  await page.evaluate(([l, t, v]) => {
    localStorage.setItem("lc-look", l);
    localStorage.setItem("lc-theme", "dark");
    localStorage.setItem("lc-last-page", JSON.stringify(t));
    localStorage.setItem("lc_onboarded", "1");
    localStorage.setItem("lc-seen-version", v);
  }, [look, tab, version] as const);
  await page.reload();
  await expect(page.locator(".nav")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500); // count-ups and entrance animations finish
  return page;
}

test("colour-blind pictures", async () => {
  const { port, token } = running!;
  await fillLibrary(port, token);
  const cdp = await running!.page.context().newCDPSession(running!.page);
  try {
    for (const look of LOOKS) {
      for (const screen of SCREENS) {
        const page = await open(look, screen);
        for (const type of VISION) {
          await cdp.send("Emulation.setEmulatedVisionDeficiency", { type });
          await page.screenshot({ path: path.join(OUT, `${screen}-${look}-${type}.png`), animations: "disabled", caret: "hide" });
        }
      }
    }
  } finally {
    await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "none" });
  }
});
