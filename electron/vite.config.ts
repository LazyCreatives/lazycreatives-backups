/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./", // relative paths so file:// works in packaged app
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
  // e2e/ holds the Playwright picture tests (npm run test:screens), not unit tests.
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
