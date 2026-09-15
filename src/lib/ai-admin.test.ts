import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAiFeatures, DEFAULT_AI_FEATURES, AI_FEATURES } from "@/lib/ai/config";
import { describeFeatureDrift } from "@/lib/ai-features-drift";
import {
  applyFeatureFlag,
  featureFlagInput,
  killSwitchInput,
  writeFeatures,
} from "@/lib/ai-admin.functions";

const invalidate = vi.fn();
const audit = vi.fn();

vi.mock("@/lib/ai/settings.server", () => ({
  AI_SETTING_KEYS: ["ai_features", "ai_limits", "ai_provider", "ai_pricing"],
  invalidateAiConfigCache: () => invalidate(),
  loadAiConfig: async (admin: any) => ({ features: await admin.__effective() }),
}));

vi.mock("@/lib/superadmin.server", () => ({
  assertSuperadmin: async () => {},
  getAdmin: async () => ({}),
  writeAudit: async (...args: unknown[]) => audit(...args),
}));

/**
 * `parseAiFeatures` is deliberately forgiving: junk in the settings row falls
 * back to the built-in default rather than breaking an AI feature. That is the
 * right call for availability and the wrong shape for an emergency stop — the
 * kill switch defaults to OFF, so a malformed value leaves AI running with no
 * error anywhere.
 *
 * These tests pin that behaviour rather than object to it. The admin surface is
 * built on the assumption that it holds; if `bool()` is ever tightened, the
 * first group fails and whoever changed it learns the drift report has become
 * redundant.
 */

describe("parseAiFeatures fail-open behaviour (pinned)", () => {
  it("reads a non-boolean kill switch as OFF", () => {
    for (const killSwitch of ["true", 1, "yes", null, {}, ["true"]]) {
      expect(parseAiFeatures({ killSwitch }).killSwitch).toBe(false);
    }
  });

  it("reads a missing kill switch as OFF", () => {
    expect(parseAiFeatures({}).killSwitch).toBe(false);
    expect(parseAiFeatures(undefined).killSwitch).toBe(false);
    expect(parseAiFeatures("not an object").killSwitch).toBe(false);
  });

  it("honours a real boolean kill switch", () => {
    expect(parseAiFeatures({ killSwitch: true }).killSwitch).toBe(true);
  });

  it("reads a non-boolean enabled as the feature's default", () => {
    const parsed = parseAiFeatures({ features: { game_assist: { enabled: "false" } } });
    expect(parsed.features.game_assist.enabled).toBe(
      DEFAULT_AI_FEATURES.features.game_assist.enabled,
    );
  });

  it("drops unknown cohorts, which fails CLOSED", () => {
    // The asymmetry worth knowing: a cohort typo narrows access, a boolean typo
    // widens it. The gate denies any cohort not listed.
    const parsed = parseAiFeatures({ features: { reel_coach: { cohorts: ["adlut"] } } });
    expect(parsed.features.reel_coach.cohorts).toEqual([]);
  });

  it("always returns every known feature", () => {
    const parsed = parseAiFeatures({ features: { not_a_feature: { enabled: true } } });
    expect(Object.keys(parsed.features).sort()).toEqual([...AI_FEATURES].sort());
  });
});

describe("describeFeatureDrift", () => {
  it("says nothing about a well-formed row", () => {
    expect(describeFeatureDrift(DEFAULT_AI_FEATURES)).toEqual([]);
    expect(describeFeatureDrift({ killSwitch: false })).toEqual([]);
    expect(describeFeatureDrift(null)).toEqual([]);
  });

  it("names a kill switch that was written as a string", () => {
    const out = describeFeatureDrift({ killSwitch: "true" });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("killSwitch");
    expect(out[0]).toContain("read as false");
  });

  it("names a misspelled top-level key", () => {
    // The exact incident this card exists for: `killswitch: true` writes
    // successfully, parses to `killSwitch: false`, and AI keeps running.
    const out = describeFeatureDrift({ killswitch: true });
    expect(out.some((m) => m.includes('unknown key "killswitch"'))).toBe(true);
  });

  it("names a misspelled feature and a non-boolean enabled", () => {
    const out = describeFeatureDrift({
      features: { reel_coche: { enabled: false }, reel_coach: { enabled: "false" } },
    });
    expect(out.some((m) => m.includes('unknown feature "reel_coche"'))).toBe(true);
    expect(out.some((m) => m.includes("features.reel_coach.enabled"))).toBe(true);
  });

  it("names each dropped cohort", () => {
    const out = describeFeatureDrift({
      features: { reel_coach: { cohorts: ["adult", "adlut", "grown_up"] } },
    });
    expect(out).toHaveLength(2);
    expect(out.join(" ")).toContain("adlut");
    expect(out.join(" ")).toContain("grown_up");
  });

  it("names a wrongly-shaped row rather than throwing", () => {
    expect(describeFeatureDrift("true")).toHaveLength(1);
    expect(describeFeatureDrift([1, 2])).toHaveLength(1);
    expect(describeFeatureDrift({ features: [] })).toHaveLength(1);
    expect(describeFeatureDrift({ features: { reel_coach: "on" } })).toHaveLength(1);
  });

  it("reports exactly what parseAiFeatures discarded", () => {
    // The card's claim is that every message corresponds to a value the gate
    // will not see. Checking both sides keeps it honest.
    const raw = { killSwitch: "true", features: { reel_coach: { cohorts: ["adult", "adlut"] } } };
    const parsed = parseAiFeatures(raw);
    expect(parsed.killSwitch).toBe(false);
    expect(parsed.features.reel_coach.cohorts).toEqual(["adult"]);
    expect(describeFeatureDrift(raw)).toHaveLength(2);
  });
});

describe("feature flag input validation", () => {
  it("rejects a feature that does not exist", () => {
    expect(featureFlagInput.safeParse({ feature: "reel_coche" }).success).toBe(false);
    expect(featureFlagInput.safeParse({ feature: "" }).success).toBe(false);
    expect(featureFlagInput.safeParse({ feature: "__proto__" }).success).toBe(false);
  });

  it("accepts every real feature", () => {
    for (const feature of AI_FEATURES) {
      expect(featureFlagInput.safeParse({ feature }).success).toBe(true);
    }
  });

  it("rejects a cohort that does not exist instead of silently dropping it", () => {
    // Writing it through and letting `cohorts()` filter it out would look like a
    // successful save that quietly narrowed the feature's reach.
    expect(
      featureFlagInput.safeParse({ feature: "reel_coach", cohorts: ["adult", "adlut"] }).success,
    ).toBe(false);
  });

  it("accepts an empty cohort list, which denies everyone", () => {
    expect(featureFlagInput.safeParse({ feature: "reel_coach", cohorts: [] }).success).toBe(true);
  });

  it("rejects a non-boolean enabled rather than coercing it", () => {
    expect(featureFlagInput.safeParse({ feature: "reel_coach", enabled: "true" }).success).toBe(
      false,
    );
    expect(killSwitchInput.safeParse({ enabled: "true" }).success).toBe(false);
    expect(killSwitchInput.safeParse({ enabled: 1 }).success).toBe(false);
    expect(killSwitchInput.safeParse({ enabled: true }).success).toBe(true);
  });
});

describe("applyFeatureFlag", () => {
  it("leaves every other feature untouched", () => {
    const next = applyFeatureFlag(DEFAULT_AI_FEATURES, {
      feature: "image_generate",
      enabled: true,
    });
    for (const f of AI_FEATURES) {
      if (f === "image_generate") continue;
      expect(next.features[f]).toEqual(DEFAULT_AI_FEATURES.features[f]);
    }
    expect(next.features.image_generate.enabled).toBe(true);
    expect(next.features.image_generate.cohorts).toEqual(
      DEFAULT_AI_FEATURES.features.image_generate.cohorts,
    );
    expect(next.killSwitch).toBe(DEFAULT_AI_FEATURES.killSwitch);
  });

  it("changes cohorts without changing enabled, and the reverse", () => {
    const cohortsOnly = applyFeatureFlag(DEFAULT_AI_FEATURES, {
      feature: "reel_coach",
      cohorts: ["adult"],
    });
    expect(cohortsOnly.features.reel_coach.cohorts).toEqual(["adult"]);
    expect(cohortsOnly.features.reel_coach.enabled).toBe(
      DEFAULT_AI_FEATURES.features.reel_coach.enabled,
    );

    const enabledOnly = applyFeatureFlag(DEFAULT_AI_FEATURES, {
      feature: "reel_coach",
      enabled: false,
    });
    expect(enabledOnly.features.reel_coach.cohorts).toEqual(
      DEFAULT_AI_FEATURES.features.reel_coach.cohorts,
    );
  });

  it("does not mutate the config it was given", () => {
    const before = structuredClone(DEFAULT_AI_FEATURES);
    applyFeatureFlag(DEFAULT_AI_FEATURES, { feature: "reel_coach", cohorts: [] });
    expect(DEFAULT_AI_FEATURES).toEqual(before);
  });

  it("survives a round trip through the parser", () => {
    // The write stores the result of this function verbatim, so whatever it
    // produces has to come back out of `parseAiFeatures` unchanged.
    const next = applyFeatureFlag(DEFAULT_AI_FEATURES, { feature: "game_assist", enabled: false });
    expect(parseAiFeatures(next)).toEqual(next);
  });
});

/**
 * A minimal stand-in for the admin client: one `ai_features` row, a record of
 * what was upserted, and an optional write failure.
 */
function fakeAdmin(stored: unknown, opts: { upsertError?: string } = {}) {
  const state = { value: stored, upserts: [] as { key: string; value: unknown }[] };
  return {
    state,
    __effective: async () => parseAiFeatures(state.value),
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { value: state.value } }) }),
        }),
        upsert: async (row: { key: string; value: unknown }) => {
          if (opts.upsertError) return { error: { message: opts.upsertError } };
          state.upserts.push(row);
          state.value = row.value;
          return { error: null };
        },
      };
    },
  };
}

const AUDIT = { action: "ai.kill_switch_on", targetId: "killSwitch", after: {} };

describe("writeFeatures", () => {
  beforeEach(() => {
    invalidate.mockClear();
    audit.mockClear();
  });

  it("drops the config cache on a successful write", async () => {
    // Without this the gate keeps serving the pre-change config for up to 30s.
    // During an emergency stop that is the entire window that matters.
    const admin = fakeAdmin(DEFAULT_AI_FEATURES);
    await writeFeatures(admin, "actor", (c) => ({ ...c, killSwitch: true }), AUDIT);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not drop the cache, or audit, when the write fails", async () => {
    const admin = fakeAdmin(DEFAULT_AI_FEATURES, { upsertError: "permission denied" });
    await expect(
      writeFeatures(admin, "actor", (c) => ({ ...c, killSwitch: true }), AUDIT),
    ).rejects.toThrow("permission denied");
    expect(invalidate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("writes a fully-formed row, repairing whatever was stored before", async () => {
    // The read-modify-write goes through the parser, so a row that was already
    // malformed is rewritten in a shape the gate can read rather than carrying
    // its defect forward.
    const admin = fakeAdmin({ killswitch: true, features: { reel_coche: {} } });
    await writeFeatures(admin, "actor", (c) => ({ ...c, killSwitch: true }), AUDIT);

    const written = admin.state.upserts[0].value as Record<string, any>;
    expect(written.killSwitch).toBe(true);
    expect(Object.keys(written.features).sort()).toEqual([...AI_FEATURES].sort());
    expect(written.killswitch).toBeUndefined();
    expect(written.features.reel_coche).toBeUndefined();
    expect(describeFeatureDrift(written)).toEqual([]);
  });

  it("returns the re-parsed config, not what the caller asked for", async () => {
    const admin = fakeAdmin(DEFAULT_AI_FEATURES);
    const out = await writeFeatures(admin, "actor", (c) => ({ ...c, killSwitch: true }), AUDIT);
    expect(out.features.killSwitch).toBe(true);
    expect(parseAiFeatures(admin.state.value).killSwitch).toBe(true);
  });

  it("audits the before state as parsed, not as stored", async () => {
    const admin = fakeAdmin({ killSwitch: "true" });
    await writeFeatures(admin, "actor", (c) => ({ ...c, killSwitch: true }), AUDIT);
    const entry = audit.mock.calls[0][2] as { before: { killSwitch: boolean } };
    // The stored row said "true"; the gate was reading false. The audit log has
    // to record what was actually in force.
    expect(entry.before.killSwitch).toBe(false);
  });
});
