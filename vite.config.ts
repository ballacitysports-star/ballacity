// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

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
