import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The real-auth integration tests (`npm run test:realauth`): they call the app's real server code against the LOCAL
 * Docker Supabase stack (real GoTrue, PostgREST, Postgres). They are named `*.itest.ts`, which the default
 * `vitest run` (vitest.config.ts, `*.test.*` and `*.spec.*` only) and Playwright never pick up, and each file
 * refuses to start unless the environment names the local stack (e2e/local-stack/local-only.ts).
 *
 *   node e2e/local-stack/stack.mjs up && set -a && . e2e/local-stack/.state/env.sh && set +a
 *   npx vitest run -c vitest.realauth.config.ts
 */
export default defineConfig({
  // The tests live under e2e/, which tsconfig.json does not include, so the "@/" alias is spelled out here.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["e2e/local-stack/**/*.itest.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
