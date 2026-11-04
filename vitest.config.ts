import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // node:test suites run on their own: release-preflight.test.mjs needs a local Postgres (bun run preflight:test);
    // rehearsal-guard.test.mjs runs with bun run rehearsal:guard:test.
    exclude: [
      "e2e/**",
      "node_modules/**",
      "dist/**",
      ".lovable/**",
      "scripts/release-preflight.test.mjs",
      "scripts/rehearsal-guard.test.mjs",
    ],
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
  },
});
