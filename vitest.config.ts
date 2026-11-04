import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // release-preflight.test.mjs is a node:test suite that needs a local Postgres (bun run preflight:test).
    exclude: [
      "e2e/**",
      "node_modules/**",
      "dist/**",
      ".lovable/**",
      "scripts/release-preflight.test.mjs",
    ],
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
  },
});
