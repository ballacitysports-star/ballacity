import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module reads the core URL through the Supabase client, so stub that rather
// than the network alone — this also pins the fact that the URL is built with
// getPublicUrl against the `app-assets` bucket, not hand-concatenated.
const getPublicUrl = vi.fn((path: string) => ({
  data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/app-assets/${path}` },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ getPublicUrl }) } },
}));

async function freshModule() {
  // assertConverterReachable memoises, so each case needs a clean module.
  vi.resetModules();
  return import("@/lib/video-transcode");
}

describe("converter reachability preflight", () => {
  beforeEach(() => {
    getPublicUrl.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("probes the pinned core version with a tiny ranged request", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 206 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { assertConverterReachable } = await freshModule();
    await expect(assertConverterReachable()).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    // A silent version drift between this module and the upload script would
    // point the app at an object nobody published, so pin it here.
    expect(url).toBe(
      "https://project.supabase.co/storage/v1/object/public/app-assets/ffmpeg/0.12.10/ffmpeg-core.wasm",
    );
    // Ranged: the real file is ~30 MiB and this runs before every conversion.
    expect(init?.headers).toMatchObject({ range: "bytes=0-1" });
  });

  it("accepts a 200 from a server that ignores Range", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const { assertConverterReachable } = await freshModule();
    await expect(assertConverterReachable()).resolves.toBeUndefined();
  });

  it("only probes once across repeated calls", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 206 }));
    vi.stubGlobal("fetch", fetchMock);

    const { assertConverterReachable } = await freshModule();
    await Promise.all([
      assertConverterReachable(),
      assertConverterReachable(),
      assertConverterReachable(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a missing core as unavailable, not as a failed clip", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const { assertConverterReachable, ConverterUnavailableError } = await freshModule();
    await expect(assertConverterReachable()).rejects.toBeInstanceOf(ConverterUnavailableError);
  });

  it("treats a network or CORS failure the same way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { assertConverterReachable, ConverterUnavailableError } = await freshModule();
    await expect(assertConverterReachable()).rejects.toBeInstanceOf(ConverterUnavailableError);
  });

  it("does not cache a failure, so a later upload can succeed", async () => {
    let status = 404;
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);

    const { assertConverterReachable } = await freshModule();
    await expect(assertConverterReachable()).rejects.toThrow();

    // The asset gets published, or the network comes back.
    status = 206;
    await expect(assertConverterReachable()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
