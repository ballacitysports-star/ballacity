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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
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

describe("privacy pass", () => {
  it("drops tags, chapters and extra tracks, and keeps only the first video and audio", async () => {
    // Read from source so the check does not depend on loading the converter.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./video-transcode.ts", import.meta.url), "utf8");
    const block = src.slice(
      src.indexOf("export const PRIVACY_ARGS"),
      src.indexOf("const PRIVACY_PASSES"),
    );
    const flat = block.replace(/[\s",\[\];]+/g, " ");
    expect(flat).toContain("-map_metadata -1");
    expect(flat).toContain("-map_chapters -1");
    expect(flat).toContain("-map 0:v:0");
    expect(flat).toContain("-map 0:a:0?");
    expect(flat).toContain("+bitexact");
  });
});

describe("plan resolution cap", () => {
  it("holds every re-encode to the cap and drops the stream-copy remux", async () => {
    const { conversionPasses } = await freshModule();
    const passes = conversionPasses(1920);
    expect(passes.map((p) => p.label)).toEqual(["standard", "720p", "silent"]);
    const filters = passes.map((p) => p.args[p.args.indexOf("-vf") + 1]);
    expect(filters[0]).toContain("min(1920,iw)");
    expect(filters[0]).toContain("force_original_aspect_ratio=decrease");
    // A lighter pass keeps its own smaller size.
    expect(filters[1]).toContain("min(1280,iw)");
    expect(filters[2]).toContain("min(960,iw)");
  });

  it("uses the pass's own ceiling when the plan allows more, and changes nothing without a cap", async () => {
    const { conversionPasses, longEdgeScaleFilter } = await freshModule();
    const passes = conversionPasses(4096);
    expect(passes[0].args).toContain(longEdgeScaleFilter(4096));
    expect(passes[1].args).toContain(longEdgeScaleFilter(1280));
    expect(conversionPasses().map((p) => p.label)).toContain("remux");
    expect(longEdgeScaleFilter(1081)).toContain("min(1080,iw)");
  });
});
