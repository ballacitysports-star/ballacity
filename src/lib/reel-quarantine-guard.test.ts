/** Signing guard: quarantined reel media is never handed out, not even to its owner. */

import { describe, expect, it } from "vitest";
import { quarantinedMediaPaths, signablePath } from "./reel-visibility.server";

function admin(rows: { path: string }[] | null, fail = false) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => (fail ? Promise.resolve({ error: { message: "down" } }) : Promise.resolve({ data: rows })),
  };
  return { from: () => chain };
}

describe("quarantinedMediaPaths", () => {
  it("returns only the quarantined paths", async () => {
    const set = await quarantinedMediaPaths(admin([{ path: "u1/bad.mp4" }]), [
      "u1/bad.mp4",
      "u1/ok.mp4",
      null,
    ]);
    expect(set.has("u1/bad.mp4")).toBe(true);
    expect(set.has("u1/ok.mp4")).toBe(false);
  });

  it("fails closed when the check itself errors", async () => {
    const set = await quarantinedMediaPaths(admin(null, true), ["u1/a.mp4", "u1/b.mp4"]);
    expect(set.has("u1/a.mp4")).toBe(true);
    expect(set.has("u1/b.mp4")).toBe(true);
  });

  it("skips the query when there is nothing to check", async () => {
    const set = await quarantinedMediaPaths(admin(null, true), [null, undefined]);
    expect(set.size).toBe(0);
  });
});

describe("signablePath", () => {
  it("refuses a quarantined path and keeps a clean one", () => {
    const q = new Set(["u1/bad.mp4"]);
    expect(signablePath("u1/bad.mp4", q)).toBeNull();
    expect(signablePath("u1/ok.mp4", q)).toBe("u1/ok.mp4");
    expect(signablePath(null, q)).toBeNull();
  });
});
