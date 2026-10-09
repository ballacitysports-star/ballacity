/**
 * Gate, quota, moderation and secret-hygiene behaviour of the AI layer.
 *
 * The provider and database calls are stubbed so the tests assert the layer's
 * own decisions (order, default-deny, fail-closed) rather than model output.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_ERROR_MESSAGES,
  AiError,
  redactSecrets,
  safeLogValue,
  providerErrorFor,
} from "./errors";
import {
  DEFAULT_AI_FEATURES,
  DEFAULT_AI_LIMITS,
  DEFAULT_AI_PRICING,
  DEFAULT_AI_PROVIDER,
  cohortAllowed,
  type AiConfig,
} from "./config";
import { AGE_COHORTS } from "@/lib/child-policy";
import { DEFAULT_MONETIZATION_CONFIG } from "@/lib/monetization/config";

const FAKE_KEY = "lov_supersecretkey_1234567890";

function baseConfig(): AiConfig {
  return {
    features: structuredClone(DEFAULT_AI_FEATURES),
    limits: structuredClone(DEFAULT_AI_LIMITS),
    provider: { ...DEFAULT_AI_PROVIDER },
    pricing: structuredClone(DEFAULT_AI_PRICING),
  };
}

/** Minimal service-role client stub: records calls, answers RPCs from a script. */
function makeAdmin(script: {
  childLocked?: boolean;
  consented?: boolean;
  /** The guardian's `child_controls.ai_analysis`; undefined means no row. */
  guardianAiAnalysis?: boolean;
  cohort?: string;
  reserve?: { allowed: boolean; reason?: string; job_id?: string };
}) {
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
      if (name === "ai_reserve_quota") {
        return { data: script.reserve ?? { allowed: true, job_id: "job-1" } };
      }
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
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "child_controls" && script.guardianAiAnalysis !== undefined
                ? { ai_analysis: script.guardianAiAnalysis }
                : null,
            error: null,
          }),
        then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
      };
      return chain;
    },
  };
}

let config = baseConfig();

vi.mock("./settings.server", () => ({
  loadAiConfig: async () => config,
}));

/**
 * Monetization defaults to free, which would hand every caller the top AI tier
 * and quietly stop these tests exercising the entitlement ladder. Pin billing
 * on so tier resolution is the thing under test; `monetizationConfig` lets an
 * individual test opt back into free mode.
 */
let monetizationConfig = {
  ...DEFAULT_MONETIZATION_CONFIG,
  access: { ...DEFAULT_MONETIZATION_CONFIG.access, platformFreeMode: false },
};

vi.mock("@/lib/monetization/settings.server", () => ({
  MONETIZATION_SETTING_KEY: "monetization",
  invalidateMonetizationConfigCache: () => {},
  loadMonetizationConfig: async () => monetizationConfig,
}));

const moderateText = vi.fn();
const moderateImage = vi.fn();

vi.mock("./gateway.server", () => ({
  createLovableGatewayProvider: () => ({
    name: "lovable",
    moderateText,
    moderateImage,
  }),
  rawChat: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/audit-log.server", () => ({ logAdminAction: vi.fn(async () => {}) }));

const { assertAiAllowed, resolveAiTier } = await import("./gate.server");
const { moderateAiText, checkReelFrameSafety, isCsamCategory } =
  await import("./moderation.server");

beforeEach(() => {
  config = baseConfig();
  monetizationConfig = {
    ...DEFAULT_MONETIZATION_CONFIG,
    access: { ...DEFAULT_MONETIZATION_CONFIG.access, platformFreeMode: false },
  };
  moderateText.mockReset();
  moderateImage.mockReset();
  process.env["LOVABLE_API_KEY"] = FAKE_KEY;
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ALLOWED";
  } catch (e) {
    return e instanceof AiError ? e.code : `OTHER:${String((e as Error).message)}`;
  }
}

describe("gate order", () => {
  it("checks the feature flag before anything else", async () => {
    config.features.features.reel_pipeline.enabled = false;
    const admin = makeAdmin({ consented: false });
    expect(await codeOf(assertAiAllowed({ admin, userId: "u1" }, "reel_pipeline"))).toBe(
      "FEATURE_DISABLED",
    );
    expect(admin.calls).toHaveLength(0);
  });

  it("checks child lock and consent before cohort and quota", async () => {
    const locked = makeAdmin({ childLocked: true, cohort: "teen_13_15" });
    expect(await codeOf(assertAiAllowed({ admin: locked, userId: "u1" }, "reel_pipeline"))).toBe(
      "PARENT_APPROVAL_REQUIRED",
    );
    expect(locked.calls).not.toContain("ai_reserve_quota");

    const noConsent = makeAdmin({ consented: false, cohort: "adult" });
    expect(await codeOf(assertAiAllowed({ admin: noConsent, userId: "u1" }, "reel_pipeline"))).toBe(
      "CONSENT_REQUIRED",
    );
    expect(noConsent.calls).not.toContain("ai_reserve_quota");
  });

  it("tells a minor whose guardian already allowed AI to turn on their own switch", async () => {
    // Guardian control on, but the member's own switch is off: ai_analysis_allowed
    // is false. Pointing at a parent here sends them to the wrong person.
    const ownSwitchOff = makeAdmin({
      consented: false,
      cohort: "child_under_13",
      guardianAiAnalysis: true,
    });
    expect(
      await codeOf(assertAiAllowed({ admin: ownSwitchOff, userId: "u1" }, "reel_pipeline")),
    ).toBe("CONSENT_REQUIRED");
    expect(ownSwitchOff.calls).not.toContain("ai_reserve_quota");
  });

  it("still asks for a parent when the guardian has not allowed AI", async () => {
    for (const guardianAiAnalysis of [false, undefined]) {
      const admin = makeAdmin({ consented: false, cohort: "teen_13_15", guardianAiAnalysis });
      expect(await codeOf(assertAiAllowed({ admin, userId: "u1" }, "reel_pipeline"))).toBe(
        "PARENT_APPROVAL_REQUIRED",
      );
      expect(admin.calls).not.toContain("ai_reserve_quota");
    }
  });

  it("keeps the parent wording when the guardian lookup fails", async () => {
    const admin: any = makeAdmin({ consented: false, cohort: "child_under_13" });
    admin.from = () => {
      throw new Error("db down");
    };
    expect(await codeOf(assertAiAllowed({ admin, userId: "u1" }, "reel_pipeline"))).toBe(
      "PARENT_APPROVAL_REQUIRED",
    );
  });

  it("checks the cohort allowance before reserving quota", async () => {
    config.features.features.reel_pipeline.cohorts = ["adult"];
    const admin = makeAdmin({ cohort: "teen_16_17" });
    expect(await codeOf(assertAiAllowed({ admin, userId: "u1" }, "reel_pipeline"))).toBe(
      "PARENT_APPROVAL_REQUIRED",
    );
    expect(admin.calls).not.toContain("ai_reserve_quota");
  });

  it("reserves quota last and allows the call", async () => {
    const admin = makeAdmin({});
    const session = await assertAiAllowed({ admin, userId: "u1" }, "reel_pipeline");
    expect(admin.calls).toEqual([
      "age_cohort_of",
      "child_features_locked",
      "ai_analysis_allowed",
      "ai_reserve_quota",
    ]);
    expect(session.jobId).toBe("job-1");
  });
});

describe("cohort default-deny", () => {
  it("denies image_generate and image_enhance for every under-18 cohort", () => {
    const minors = AGE_COHORTS.filter((c) => c !== "adult");
    for (const feature of ["image_generate", "image_enhance"] as const) {
      const flag = DEFAULT_AI_FEATURES.features[feature];
      for (const cohort of minors) expect(cohortAllowed(flag, cohort)).toBe(false);
    }
  });

  it("ships image_generate and image_enhance disabled for adults too", () => {
    expect(DEFAULT_AI_FEATURES.features.image_generate.enabled).toBe(false);
    expect(DEFAULT_AI_FEATURES.features.image_enhance.enabled).toBe(false);
  });

  it("denies a cohort that is simply not listed", () => {
    expect(cohortAllowed({ enabled: true, cohorts: ["adult"] }, "teen_13_15")).toBe(false);
    expect(cohortAllowed({ enabled: true, cohorts: ["adult"] }, "unknown")).toBe(false);
  });
});

describe("quota and concurrency denials", () => {
  it("returns QUOTA_EXCEEDED", async () => {
    const admin = makeAdmin({ reserve: { allowed: false, reason: "QUOTA_EXCEEDED" } });
    expect(await codeOf(assertAiAllowed({ admin, userId: "u1" }, "reel_pipeline"))).toBe(
      "QUOTA_EXCEEDED",
    );
  });

  it("returns CONCURRENCY_LIMIT", async () => {
    const admin = makeAdmin({ reserve: { allowed: false, reason: "CONCURRENCY_LIMIT" } });
    expect(await codeOf(assertAiAllowed({ admin, userId: "u1" }, "reel_pipeline"))).toBe(
      "CONCURRENCY_LIMIT",
    );
  });
});

describe("cost controls can never disable safety scanning", () => {
  it("kill switch denies reel generation but still lets moderation run", async () => {
    config.features.killSwitch = true;

    const admin = makeAdmin({});
    expect(await codeOf(assertAiAllowed({ admin, userId: "u1" }, "reel_pipeline"))).toBe(
      "FEATURE_DISABLED",
    );

    // Same kill switch, moderation still allowed and unmetered (no job row).
    const modSession = await assertAiAllowed({ admin, userId: "u1" }, "text_moderation");
    expect(modSession.jobId).toBeNull();

    moderateText.mockResolvedValue({
      verdict: "allow",
      categories: [],
      reason: null,
      model: "m",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const outcome = await moderateAiText(admin, {
      userId: "u1",
      text: "great game",
      target: { table: "highlight_reels", field: "ai_title" },
    });
    expect(moderateText).toHaveBeenCalled();
    expect(outcome.verdict).toBe("allow");
    expect(outcome.value).toBe("great game");
  });

  it("holds AI text owner-only when moderation is switched off", async () => {
    config.features.features.text_moderation.enabled = false;
    const admin = makeAdmin({});
    const outcome = await moderateAiText(admin, {
      userId: "u1",
      text: "anything",
      target: { table: "highlight_reels", field: "ai_caption" },
    });
    expect(moderateText).not.toHaveBeenCalled();
    expect(outcome.verdict).toBe("review");
    expect(outcome.unavailable).toBe(true);
  });
});

describe("moderation verdicts", () => {
  const admin = makeAdmin({});

  it("blocks and drops the text", async () => {
    moderateText.mockResolvedValue({
      verdict: "block",
      categories: ["hate"],
      reason: null,
      model: "m",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const out = await moderateAiText(admin, {
      userId: "u1",
      text: "bad words",
      target: { table: "highlight_reels", field: "ai_title" },
    });
    expect(out.verdict).toBe("block");
    expect(out.value).toBe("");
  });

  it("keeps review text but marks it for owner-only display", async () => {
    moderateText.mockResolvedValue({
      verdict: "review",
      categories: ["profanity"],
      reason: null,
      model: "m",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const out = await moderateAiText(admin, {
      userId: "u1",
      text: "borderline",
      target: { table: "highlight_reels", field: "ai_title" },
    });
    expect(out.verdict).toBe("review");
    expect(out.value).toBe("borderline");
  });

  it("fails closed when the checker throws", async () => {
    moderateText.mockRejectedValue(new Error("gateway down"));
    const out = await moderateAiText(admin, {
      userId: "u1",
      text: "hello",
      target: { table: "highlight_reels", field: "ai_title" },
    });
    expect(out.verdict).toBe("review");
    expect(out.unavailable).toBe(true);
  });

  it("holds a reel back when no frame could be checked", async () => {
    moderateImage.mockRejectedValue(new Error("down"));
    const out = await checkReelFrameSafety(admin, {
      userId: "u1",
      reelId: "r1",
      frames: ["data:image/png;base64,AAA"],
    });
    expect(out.safe).toBe(false);
    expect(out.unavailable).toBe(true);
  });

  it("flags a child-safety verdict for quarantine", async () => {
    moderateImage.mockResolvedValue({
      safe: false,
      label: "csam",
      categories: ["csam"],
      reason: null,
      model: "m",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const out = await checkReelFrameSafety(admin, {
      userId: "u1",
      reelId: "r1",
      frames: ["data:image/png;base64,AAA"],
    });
    expect(out.safe).toBe(false);
    expect(out.csam).toBe(true);
    expect(isCsamCategory(out.categories)).toBe(true);
  });
});

describe("error mapping and secret hygiene", () => {
  it("maps provider statuses to typed, user-safe errors", () => {
    expect(providerErrorFor(429).code).toBe("RATE_LIMITED");
    expect(providerErrorFor(504).code).toBe("TIMEOUT");
    expect(providerErrorFor(400).code).toBe("PROVIDER_ERROR");
    for (const code of Object.keys(AI_ERROR_MESSAGES) as (keyof typeof AI_ERROR_MESSAGES)[]) {
      expect(new AiError(code).userMessage).toBe(AI_ERROR_MESSAGES[code]);
    }
  });

  it("never lets the API key escape through an error or a logged object", () => {
    const err = providerErrorFor(500, `call failed with key ${FAKE_KEY}`);
    const serialized = JSON.stringify(err) + err.message + String(err) + err.userMessage;
    expect(serialized).not.toContain(FAKE_KEY);
    expect(JSON.stringify(err.toClient())).not.toContain(FAKE_KEY);

    const logged = JSON.stringify(
      safeLogValue({ apiKey: FAKE_KEY, note: `bearer ${FAKE_KEY}`, nested: { token: FAKE_KEY } }),
    );
    expect(logged).not.toContain(FAKE_KEY);
    expect(redactSecrets(FAKE_KEY)).toBe("[redacted]");
  });
});

describe("AI tier follows the monetization switch", () => {
  /** Minimal admin stub: only the subscriptions read matters here. */
  function adminWith(rows: unknown[]) {
    return {
      from: () => ({ select: () => ({ eq: async () => ({ data: rows }) }) }),
    };
  }

  it("gives everyone the configured tier while BallaCity is free", async () => {
    monetizationConfig = {
      ...DEFAULT_MONETIZATION_CONFIG,
      access: { ...DEFAULT_MONETIZATION_CONFIG.access, platformFreeMode: true },
    };
    // No subscription at all, yet still the top tier.
    expect(await resolveAiTier(adminWith([]), "u1")).toBe("gym");
  });

  it("honours a superadmin dialling the free-mode tier down", async () => {
    monetizationConfig = {
      ...DEFAULT_MONETIZATION_CONFIG,
      access: {
        ...DEFAULT_MONETIZATION_CONFIG.access,
        platformFreeMode: true,
        freeModeAiTier: "premium",
      },
    };
    expect(await resolveAiTier(adminWith([]), "u1")).toBe("premium");
  });

  it("goes back to deriving the tier from real subscriptions once billing is on", async () => {
    expect(await resolveAiTier(adminWith([]), "u1")).toBe("free");
    expect(
      await resolveAiTier(
        adminWith([{ status: "active", price_id: "team_plan_monthly", tier: null }]),
        "u1",
      ),
    ).toBe("team");
    expect(
      await resolveAiTier(
        adminWith([{ status: "active", price_id: "ai_highlight_reel_monthly", tier: null }]),
        "u1",
      ),
    ).toBe("premium");
  });
});
