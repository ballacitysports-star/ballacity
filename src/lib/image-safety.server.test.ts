import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_CONFIG, type AiConfig } from "@/lib/ai/config";
import type { AiProvider } from "@/lib/ai/provider";

const recordUsage = vi.fn(async () => {});
vi.mock("@/lib/ai/usage.server", () => ({ recordUsage }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/audit-log.server", () => ({ logAdminAction: vi.fn(async () => {}) }));

const { scanImageForSafety } = await import("./image-safety.server");

function provider(moderateImage: AiProvider["moderateImage"]): AiProvider {
  return { name: "lovable", moderateImage } as unknown as AiProvider;
}

function configWith(enabled: boolean): AiConfig {
  const features = structuredClone(DEFAULT_AI_CONFIG.features);
  features.features.image_moderation.enabled = enabled;
  return { ...DEFAULT_AI_CONFIG, features };
}

const usage = { inputTokens: 10, outputTokens: 5 };

beforeEach(() => recordUsage.mockClear());

describe("scanImageForSafety", () => {
  it("passes a safe image and records usage", async () => {
    const v = await scanImageForSafety(
      "data:x",
      { userId: "u1" },
      {
        admin: {},
        config: configWith(true),
        provider: provider(async () => ({
          safe: true,
          label: "safe",
          categories: [],
          reason: null,
          model: "m",
          usage,
        })),
      },
    );
    expect(v).toMatchObject({ safe: true, scanned: true, csam: false });
    expect(recordUsage).toHaveBeenCalledWith(
      {},
      { jobId: null, userId: "u1", feature: "image_moderation" },
      expect.objectContaining({ outcome: "ok", model: "m" }),
    );
  });

  it("flags CSAM as unsafe even if the classifier said safe", async () => {
    const v = await scanImageForSafety(
      "data:x",
      { userId: "u1" },
      {
        admin: {},
        config: configWith(true),
        provider: provider(async () => ({
          safe: true,
          label: "csam",
          categories: [],
          reason: "x",
          model: "m",
          usage,
        })),
      },
    );
    expect(v).toMatchObject({ safe: false, csam: true, scanned: true });
    expect(recordUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ outcome: "blocked" }),
    );
  });

  it("reports a failed scan as unscanned, never as a scanned pass", async () => {
    const v = await scanImageForSafety(
      "data:x",
      { userId: "u1" },
      {
        admin: {},
        config: configWith(true),
        provider: provider(async () => {
          throw new Error("down");
        }),
      },
    );
    expect(v).toMatchObject({ scanned: false, csam: false, label: "unscanned" });
    expect(recordUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ outcome: "error" }),
    );
  });

  it("does not call the provider when image moderation is switched off", async () => {
    const moderateImage = vi.fn();
    const v = await scanImageForSafety(
      "data:x",
      { userId: "u1" },
      { admin: {}, config: configWith(false), provider: provider(moderateImage) },
    );
    expect(v.scanned).toBe(false);
    expect(moderateImage).not.toHaveBeenCalled();
  });
});
