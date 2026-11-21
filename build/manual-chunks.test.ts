import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { manualChunks } from "./manual-chunks";

const nm = (pkg: string, file = "index.js") => `/repo/node_modules/${pkg}/dist/${file}`;

describe("manualChunks", () => {
  it("leaves app code and unlisted libraries to Rollup", () => {
    expect(manualChunks("/repo/src/routes/__root.tsx")).toBeUndefined();
    expect(manualChunks(nm("react-dom"))).toBeUndefined();
    expect(manualChunks(nm("@tanstack/react-router"))).toBeUndefined();
  });

  it("keeps the charts library in its own chunk", () => {
    for (const pkg of ["recharts", "d3-scale", "d3-shape", "victory-vendor"]) {
      expect(manualChunks(nm(pkg))).toBe("vendor-charts");
    }
  });

  it("never puts helpers the whole app uses inside the charts chunk", () => {
    // clsx sits behind cn(); recharts depends on it too. If it lands in
    // vendor-charts, every page downloads recharts + lodash before first paint.
    for (const pkg of ["clsx", "tiny-invariant", "tiny-warning", "react-is", "prop-types"]) {
      expect(manualChunks(nm(pkg))).toBe("vendor-shared");
    }
    expect(manualChunks(nm("@babel/runtime", "helpers/esm/extends.js"))).toBe("vendor-shared");
  });

  it("does not mistake look-alike package names for shared helpers", () => {
    expect(manualChunks(nm("clsx-extras"))).toBeUndefined();
    expect(manualChunks(nm("react-is-mounted"))).toBeUndefined();
  });

  it("splits the other heavy libraries as before", () => {
    expect(manualChunks(nm("zod"))).toBe("vendor-zod");
    expect(manualChunks(nm("@supabase/storage-js"))).toBe("vendor-supabase-extras");
    expect(manualChunks(nm("@radix-ui/react-dialog"))).toBe("vendor-ui");
    expect(manualChunks(nm("date-fns"))).toBe("vendor-forms");
  });

  it("handles Windows-style paths", () => {
    expect(manualChunks("C:\\repo\\node_modules\\clsx\\dist\\clsx.mjs")).toBe("vendor-shared");
    expect(manualChunks("C:\\repo\\node_modules\\recharts\\es6\\index.js")).toBe("vendor-charts");
  });

  it("leaves framer-motion to Rollup, so the app shell does not download the animation engine", () => {
    // As one forced chunk, every page loaded all of framer-motion (47 kB gzip) before first
    // paint, because the shell imports MotionConfig. Left to Rollup, the shell keeps only the
    // small config modules and the engine travels with the routes that animate (P3-4).
    for (const pkg of ["framer-motion", "motion-dom", "motion-utils"]) {
      expect(manualChunks(nm(pkg))).toBeUndefined();
    }
  });

  it("keeps the shell's framer-motion use to MotionConfig", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root.match(/import \{([^}]*)\} from "framer-motion"/)?.[1].trim()).toBe("MotionConfig");
    // The swipe wrapper around every page animates with CSS, not framer-motion.
    expect(readFileSync("src/components/navigation/SwipeNavigator.tsx", "utf8")).not.toMatch(
      /from "framer-motion"/,
    );
  });
});
