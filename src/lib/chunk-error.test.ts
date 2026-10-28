import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./chunk-error";

describe("isChunkLoadError", () => {
  it("recognises a stale-deploy import failure in each browser's words", () => {
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
    expect(
      isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://x/a.js")),
    ).toBe(true);
    expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 12 failed."))).toBe(true);
    expect(isChunkLoadError("Importing a module script failed.")).toBe(true);
  });

  it("is not fooled by a cancelled request or an ordinary error", () => {
    expect(isChunkLoadError(new Error("The operation was aborted"))).toBe(false);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
