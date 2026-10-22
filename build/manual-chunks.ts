/**
 * Rollup `manualChunks` for the client build: splits large third-party
 * libraries out of the shared entry chunk so the first paint of / and /profile
 * only downloads what it needs, and heavy libs used by a subset of routes load
 * on demand (and cache separately).
 *
 * Kept out of vite.config.ts so the rules can be tested: a rule in the wrong
 * order silently makes the entry download a heavy chunk on every page.
 */
export function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return;
  if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id))
    return "vendor-motion";
  if (/[\\/]node_modules[\\/]zod[\\/]/.test(id)) return "vendor-zod";
  if (/[\\/]node_modules[\\/]@supabase[\\/](realtime-js|storage-js|functions-js|phoenix)/.test(id))
    return "vendor-supabase-extras";
  if (/[\\/]node_modules[\\/](@radix-ui|@floating-ui|cmdk|embla-carousel|vaul)[\\/]/.test(id))
    return "vendor-ui";
  // Tiny helpers that recharts also depends on (clsx is behind cn(), so every
  // page uses it). Left to Rollup they were folded into the charts chunk, which
  // made the entry import it and download recharts + lodash (~385 kB) before the
  // first paint of any page. Pin them to their own small shared chunk so only
  // the admin chart page loads the charts. Must stay ahead of the charts rule.
  if (
    /[\\/]node_modules[\\/](clsx|tiny-invariant|tiny-warning|react-is|prop-types|@babel[\\/]runtime)[\\/]/.test(
      id,
    )
  )
    return "vendor-shared";
  if (/[\\/]node_modules[\\/](recharts|d3-|victory)/.test(id)) return "vendor-charts";
  if (/[\\/]node_modules[\\/](date-fns|react-hook-form|@hookform)[\\/]/.test(id))
    return "vendor-forms";
  return;
}
