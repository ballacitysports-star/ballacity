import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    exclude: ["e2e/**", "node_modules/**", "dist/**", ".lovable/**"],
  },
});
