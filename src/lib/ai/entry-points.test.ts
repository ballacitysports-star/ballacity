/**
 * Entry-point level consent and minor checks.
 *
 * Every AI server function (reel processing, Reel Coach, reel package, style
 * draft, background removal) runs its work inside `withAiSession`, so these
 * tests drive the real session wrapper with the real gate for each feature and
 * assert the refusal happens *before* any provider call, job row or quota
 * reservation. The source assertions below pin the feature each entry point
 * uses, so a new entry point cannot quietly skip the gate.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERROR_MESSAGES } from "./errors";
import {
  DEFAULT_AI_FEATURES,
  DEFAULT_AI_LIMITS,
  DEFAULT_AI_PRICING,
  DEFAULT_AI_PROVIDER,
  type AiConfig,
  type AiFeature,
} from "./config";
import { AGE_COHORTS } from "@/lib/child-policy";

/** Features used by the AI server functions, keyed by the entry point. */
const ENTRY_POINTS: Record<string, { file: string; feature: AiFeature }> = {
  processMyReels: { file: "src/lib/reels.functions.ts", feature: "reel_pipeline" },
  askReelCoach: { file: "src/lib/reels.functions.ts", feature: "reel_coach" },
  buildReelPackage: { file: "src/lib/reels.functions.ts", feature: "reel_package" },
  previewReelStyle: { file: "src/lib/reels.functions.ts", feature: "reel_style" },
  removeBackground: { file: "src/lib/bg-remove.functions.ts", feature: "background_remove" },
};

function baseConfig(): AiConfig {
  return {
    features: structuredClone(DEFAULT_AI_FEATURES),
    limits: structuredClone(DEFAULT_AI_LIMITS),
    provider: { ...DEFAULT_AI_PROVIDER },
    pricing: structuredClone(DEFAULT_AI_PRICING),
  };
}

/** Service-role stub that records RPC calls and any row it was asked to write. */
function makeAdmin(script: { consented?: boolean; childLocked?: boolean; cohort?: string }) {
  const calls: string[] = [];
  const inserted: Record<string, any[]> = {};
  return {
    calls,
    inserted,
    async rpc(name: string) {
      calls.push(name);
      if (name === "child_features_locked") return { data: script.childLocked === true };
      if (name === "ai_analysis_allowed") return { data: script.consented !== false };
      if (name === "age_cohort_of") return { data: script.cohort ?? "adult" };
      if (name === "ai_reserve_quota") return { data: { allowed: true, job_id: "job-1" } };
      return { data: null };
    },
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        insert: (rows: any) => {
          inserted[table] = [...(inserted[table] ?? []), rows];
          return Promise.resolve({ error: null });
        },
        update: () => chain,
        then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
      };
      return chain;
    },
  };
}

let config = baseConfig();

vi.mock("./settings.server", () => ({ loadAiConfig: async () => config }));

const providerCall = vi.fn();

vi.mock("./gateway.server", () => ({
  createLovableGatewayProvider: () => ({
    name: "lovable",
    generateText: providerCall,
    generateStructured: providerCall,
    analyzeImages: providerCall,
    moderateText: providerCall,
    moderateImage: providerCall,
  }),
  rawChat: providerCall,
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/audit-log.server", () => ({ logAdminAction: vi.fn(async () => {}) }));

const { withAiSession } = await import("./session.server");

beforeEach(() => {
  config = baseConfig();
  providerCall.mockReset();
  process.env["LOVABLE_API_KEY"] = "lov_testkey_0000";
});

describe("entry points wire the gate", () => {
  for (const [name, { file, feature }] of Object.entries(ENTRY_POINTS)) {
    it(`${name} runs its work inside withAiSession with feature ${feature}`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain(`feature: "${feature}"`);
    });
  }
});

describe("consent / child policy refuses before any AI work", () => {
  for (const [name, { feature }] of Object.entries(ENTRY_POINTS)) {
    it(`${name} is refused with CONSENT_REQUIRED when consent is off`, async () => {
      const admin = makeAdmin({ consented: false });
      const work = vi.fn();
      await expect(
        withAiSession({ admin, userId: "u1", feature }, work as any),
      ).rejects.toThrow(AI_ERROR_MESSAGES.CONSENT_REQUIRED);

      expect(work).not.toHaveBeenCalled();
      expect(providerCall).not.toHaveBeenCalled();
      expect(admin.calls).not.toContain("ai_reserve_quota");
      expect(admin.inserted["ai_generation_jobs"]).toBeUndefined();
      expect(admin.inserted["ai_usage_events"]).toBeUndefined();
    });

    it(`${name} is refused with PARENT_APPROVAL_REQUIRED for a locked child account`, async () => {
      const admin = makeAdmin({ childLocked: true, cohort: "teen_13_15" });
      const work = vi.fn();
      await expect(
        withAiSession({ admin, userId: "kid", feature }, work as any),
      ).rejects.toThrow(AI_ERROR_MESSAGES.PARENT_APPROVAL_REQUIRED);

      expect(work).not.toHaveBeenCalled();
      expect(providerCall).not.toHaveBeenCalled();
      expect(admin.calls).not.toContain("ai_reserve_quota");
      expect(admin.inserted["ai_generation_jobs"]).toBeUndefined();
    });
  }
});

describe("image generation stays closed for minors", () => {
  for (const feature of ["image_generate", "image_enhance"] as const) {
    it(`${feature} is refused for an under-13 account even with consent`, async () => {
      // Enabled for adults, so only the cohort allowance can refuse this.
      config.features.features[feature].enabled = true;
      const admin = makeAdmin({ consented: true, cohort: "child_under_13" });
      const work = vi.fn();
      await expect(
        withAiSession({ admin, userId: "kid", feature }, work as any),
      ).rejects.toThrow(AI_ERROR_MESSAGES.PARENT_APPROVAL_REQUIRED);

      expect(work).not.toHaveBeenCalled();
      expect(providerCall).not.toHaveBeenCalled();
      expect(admin.calls).not.toContain("ai_reserve_quota");
    });

    it(`${feature} is refused for every minor cohort`, async () => {
      config.features.features[feature].enabled = true;
      for (const cohort of AGE_COHORTS.filter((c) => c !== "adult")) {
        const admin = makeAdmin({ consented: true, cohort });
        await expect(
          withAiSession({ admin, userId: "kid", feature }, vi.fn() as any),
        ).rejects.toThrow(AI_ERROR_MESSAGES.PARENT_APPROVAL_REQUIRED);
      }
    });
  }
});
