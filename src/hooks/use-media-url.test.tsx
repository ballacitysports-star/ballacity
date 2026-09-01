// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Contract: private media is resolved through a short-lived signed URL on every
 * view; public values pass through untouched; and a viewer who is not allowed
 * to see a private object renders nothing rather than a broken image.
 */

const signCalls: { bucket: string; path: string; ttl: number }[] = [];
let signResult: { signedUrl: string } | null = { signedUrl: "https://x/signed?token=fresh" };
const publicSignerCalls: string[] = [];
let publicSignerResult: string | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number) => {
          signCalls.push({ bucket, path, ttl });
          return signResult ? { data: signResult, error: null } : { data: null, error: new Error("denied") };
        },
      }),
    },
  },
}));

vi.mock("@/lib/media-urls.functions", () => ({
  signPublicGameCover: async ({ data }: { data: { ref: string } }) => {
    publicSignerCalls.push(data.ref);
    return { url: publicSignerResult };
  },
}));

const { useMediaUrl, clearMediaUrlCache } = await import("@/hooks/use-media-url");
const { MEDIA_SIGNED_URL_TTL_SECONDS } = await import("@/lib/media-refs");

beforeEach(() => {
  signCalls.length = 0;
  publicSignerCalls.length = 0;
  signResult = { signedUrl: "https://x/signed?token=fresh" };
  publicSignerResult = null;
  clearMediaUrlCache();
});

describe("useMediaUrl", () => {
  it("passes public values through without signing", () => {
    const { result } = renderHook(() => useMediaUrl("/assets/hoops.jpg"));
    expect(result.current).toBe("/assets/hoops.jpg");
    expect(signCalls).toHaveLength(0);
  });

  it("signs a private reference with the short TTL", async () => {
    const { result } = renderHook(() => useMediaUrl("storage://game-covers/u1/c.png"));
    await waitFor(() => expect(result.current).toBe("https://x/signed?token=fresh"));
    expect(signCalls).toEqual([
      { bucket: "game-covers", path: "u1/c.png", ttl: MEDIA_SIGNED_URL_TTL_SECONDS },
    ]);
  });

  it("re-signs legacy long-lived URLs instead of reusing the stale token", async () => {
    const { result } = renderHook(() =>
      useMediaUrl("https://x/storage/v1/object/sign/game-covers/u1/c.png?token=STALE"),
    );
    await waitFor(() => expect(result.current).toBe("https://x/signed?token=fresh"));
    expect(result.current).not.toContain("STALE");
  });

  it("caches within the window so one reference signs once", async () => {
    const a = renderHook(() => useMediaUrl("storage://game-covers/u1/c.png"));
    await waitFor(() => expect(a.result.current).toBeTruthy());
    const b = renderHook(() => useMediaUrl("storage://game-covers/u1/c.png"));
    await waitFor(() => expect(b.result.current).toBeTruthy());
    expect(signCalls).toHaveLength(1);
  });

  it("falls back to the public game-cover signer for visitors", async () => {
    signResult = null;
    publicSignerResult = "https://x/public-signed";
    const { result } = renderHook(() => useMediaUrl("storage://game-covers/u1/c.png"));
    await waitFor(() => expect(result.current).toBe("https://x/public-signed"));
    expect(publicSignerCalls).toEqual(["storage://game-covers/u1/c.png"]);
  });

  it("resolves to nothing when the viewer is not allowed to see the object", async () => {
    signResult = null;
    const { result } = renderHook(() => useMediaUrl("storage://highlight-videos/u1/v.mp4"));
    await waitFor(() => expect(signCalls).toHaveLength(1));
    expect(result.current).toBeNull();
    expect(publicSignerCalls).toHaveLength(0);
  });
});
