// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// `.env.production` holds the publishable backend URL and key, committed
// because the managed .env is not available to the deploy build. Vite only
// loads a `.env.<mode>` file in that mode, so every non-production build —
// the live preview and `build:dev` among them — came up with no Supabase
// configuration at all. `createClient` throws on the first missing variable,
// which is why those builds rendered the boot error screen instead of the app
// while production was fine.
//
// Seed the same values for every mode. Anything already present wins, so
// Lovable's managed injection and the CI secrets still take precedence, and a
// `.env.local` override still beats this because Vite applies it later.
seedEnvFromProductionFile();

function seedEnvFromProductionFile() {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), ".env.production");
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return; // Nothing to seed from; the environment is expected to supply them.
  }
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue; // comment, blank, or malformed
    const [, key, rawValue] = match;
    if (process.env[key]) continue; // never override a real environment value
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPlugin()],
    environments: {
      client: {
        build: {
      // Split large third-party libraries out of the shared entry chunk so the
      // first paint of / and /profile only downloads what it needs, and heavy
      // libs used by a subset of routes load on demand (and cache separately).
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return;
            if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id))
              return "vendor-motion";
            if (/[\\/]node_modules[\\/]zod[\\/]/.test(id)) return "vendor-zod";
            if (/[\\/]node_modules[\\/]@supabase[\\/](realtime-js|storage-js|functions-js|phoenix)/.test(id))
              return "vendor-supabase-extras";
            if (/[\\/]node_modules[\\/](@radix-ui|@floating-ui|cmdk|embla-carousel|vaul)[\\/]/.test(id))
              return "vendor-ui";
            if (/[\\/]node_modules[\\/](recharts|d3-|victory)/.test(id)) return "vendor-charts";
            if (/[\\/]node_modules[\\/](date-fns|react-hook-form|@hookform)[\\/]/.test(id))
              return "vendor-forms";
            return;
          },
            },
          },
        },
      },
    },
  },
});
