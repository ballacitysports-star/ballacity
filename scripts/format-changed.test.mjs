import { describe, expect, it } from "vitest";
import { formattable } from "./format-changed.mjs";

describe("formattable", () => {
  it("keeps source, config and style files", () => {
    expect(
      formattable(["src/a.ts", "src/b.tsx", "vite.config.ts", "x.json", "y.css", "z.mjs"]),
    ).toEqual(["src/a.ts", "src/b.tsx", "vite.config.ts", "x.json", "y.css", "z.mjs"]);
  });

  it("leaves out what Prettier does not own: SQL, images, docs", () => {
    expect(formattable(["supabase/migrations/1.sql", "public/a.png", "README.md", "a.sh"])).toEqual(
      [],
    );
  });

  it("leaves out generated and vendored files", () => {
    expect(
      formattable([
        "src/routeTree.gen.ts",
        "src/integrations/supabase/types.ts",
        "node_modules/x/index.js",
        "src/real.ts",
      ]),
    ).toEqual(["src/real.ts"]);
  });

  it("removes duplicates, blanks and stray whitespace, and sorts", () => {
    expect(formattable(["src/b.ts", " src/a.ts ", "src/b.ts", ""])).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});
