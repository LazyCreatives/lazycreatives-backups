import { defineConfig } from "@playwright/test";

// Picture tests: start the real Electron app and compare each main screen, in both
// looks, with a saved picture. See e2e/README.md.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  // Colour-blind pictures only run when asked for (npm run test:colourblind).
  testIgnore: process.env.COLOURBLIND ? [] : ["colourblind.spec.ts"],
  globalSetup: "./global-setup.ts",
  outputDir: "./test-results",
  // One app at a time: every test drives the same window, one screen after another.
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  // Pictures are kept per platform (linux / win32 / darwin): fonts and scrollbars
  // differ between systems, so each one has its own saved set.
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // A few stray pixels from anti-aliasing are fine; a moved button is not.
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
