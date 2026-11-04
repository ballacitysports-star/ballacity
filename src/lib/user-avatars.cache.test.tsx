// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => new Promise(() => {}), // never answers: only what was cached can show
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "viewer" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("avatar cache and restricted names", () => {
  it("deletes the old cache and never serves a name from it", async () => {
    localStorage.setItem(
      "ballacity.avatarCache.v1",
      JSON.stringify({
        viewer: "viewer",
        entries: { "minor-host": { n: "Taylor Quinn", i: "TQ", u: null, h: false, t: Date.now() } },
      }),
    );
    const { useUserAvatar } = await import("./user-avatars");
    const { result } = renderHook(() => useUserAvatar("minor-host"));
    expect(localStorage.getItem("ballacity.avatarCache.v1")).toBeNull();
    expect(result.current.name).toBeNull();
    expect(JSON.stringify(result.current)).not.toContain("Taylor");
  });

  it("is cleared with the other per-account data when the person changes", async () => {
    const { PER_USER_STORAGE_KEYS } = await import("./per-user-state");
    expect(PER_USER_STORAGE_KEYS).toEqual(
      expect.arrayContaining(["ballacity.avatarCache.v1", "ballacity.avatarCache.v2"]),
    );
  });
});
