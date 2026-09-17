/**
 * The catalog of what a superadmin may price.
 *
 * Every entry maps to something that actually exists in this codebase. A switch
 * that governs nothing is worse than no switch: it tells an admin they have
 * control they do not have. Features the product advertises but has never
 * implemented are deliberately absent (see `docs/monetization-free-mode.md`).
 *
 * Three tiers live here:
 *
 *  - **gateable** — real, optional capability. Free / Premium / Disabled.
 *  - **alwaysFree** — the capabilities `ALWAYS_FREE_CAPABILITIES` protects.
 *    Listed so an admin can see they exist and are deliberately unpriceable.
 *  - **safety** — moderation. Never priceable, never switchable. Gating these
 *    would charge members not to have their content held for review, and the
 *    AI layer already exempts them from the kill switch, consent, cohort and
 *    quota checks (`PLATFORM_FEATURES` in `@/lib/ai/gate.server`).
 */

import type { EntitlementKey } from "./config";
import type { FeatureKey as SafetyFeatureKey } from "@/lib/child-policy";

export type FeatureTier = "gateable" | "alwaysFree" | "safety";

export type MonetizableFeature = {
  key: string;
  label: string;
  /** What it actually controls, and where. Shown to the superadmin. */
  description: string;
  tier: FeatureTier;
  /** Which entitlement satisfies this feature when it is set to `premium`. */
  entitlement: EntitlementKey;
  /**
   * The child-policy feature this maps onto, or null when the capability has
   * no age/guardian dimension. Explicit `null` rather than an omission, so a
   * missing mapping is a test failure instead of a silently skipped safety
   * check.
   */
  safetyKey: SafetyFeatureKey | null;
};

export const FEATURE_REGISTRY: MonetizableFeature[] = [
  // ---------------------------------------------------------------- gateable
  {
    key: "ai_reel_pipeline",
    label: "AI highlight reel generation",
    description: "Turning an uploaded clip into a highlight reel (processMyReels).",
    tier: "gateable",
    entitlement: "player_plus",
    safetyKey: "ai_analysis",
  },
  {
    key: "ai_reel_coach",
    label: "AI reel coach",
    description: "Coaching feedback on a reel (askReelCoach).",
    tier: "gateable",
    entitlement: "player_plus",
    safetyKey: "ai_analysis",
  },
  {
    key: "ai_reel_package",
    label: "AI reel package",
    description: "Captions, titles and share copy for a reel (buildReelPackage).",
    tier: "gateable",
    entitlement: "player_plus",
    safetyKey: "ai_analysis",
  },
  {
    key: "ai_reel_style",
    label: "AI reel styles",
    description: "Style presets and previews for a reel (previewReelStyle).",
    tier: "gateable",
    entitlement: "player_plus",
    safetyKey: "ai_analysis",
  },
  {
    key: "ai_background_remove",
    label: "AI background removal",
    description: "Removing the background from a profile or team image.",
    tier: "gateable",
    entitlement: "player_plus",
    safetyKey: "ai_analysis",
  },
  {
    key: "reel_creation",
    label: "Creating highlight reels",
    description:
      "Uploading a clip at all. Set to premium to apply the free reel allowance; " +
      "note the allowance is display-only today (used_free is never written).",
    tier: "gateable",
    entitlement: "player_plus",
    safetyKey: "video_upload",
  },
  {
    key: "merch_shop",
    label: "Merch shop",
    description: "The /shop route and its sitemap entry.",
    tier: "gateable",
    entitlement: "player_plus",
    safetyKey: null,
  },

  // -------------------------------------------------------------- alwaysFree
  {
    key: "discover_games",
    label: "Discovering games",
    description: "Search, filters and the game feed. Free forever.",
    tier: "alwaysFree",
    entitlement: "player_plus",
    safetyKey: "game_discovery",
  },
  {
    key: "join_game",
    label: "Joining games",
    description: "Requesting to join and taking a roster spot. Free forever.",
    tier: "alwaysFree",
    entitlement: "player_plus",
    safetyKey: "game_participation",
  },
  {
    key: "host_game",
    label: "Hosting games",
    description: "Creating and running games. Free forever.",
    tier: "alwaysFree",
    entitlement: "host_pro",
    safetyKey: "game_hosting",
  },
  {
    key: "messaging",
    label: "Messaging",
    description: "Direct messages and game chat. Free forever.",
    tier: "alwaysFree",
    entitlement: "player_plus",
    safetyKey: "direct_messaging",
  },
  {
    key: "teams",
    label: "Teams",
    description: "Team pages, rosters and posts. Free forever.",
    tier: "alwaysFree",
    entitlement: "team_pro",
    safetyKey: "team_membership",
  },
  {
    key: "reputation",
    label: "Reputation & reviews",
    description: "Badges, reviews and player stats. Free forever.",
    tier: "alwaysFree",
    entitlement: "player_plus",
    safetyKey: null,
  },
  {
    key: "availability",
    label: "Availability",
    description: "Posting when you can play. Free forever.",
    tier: "alwaysFree",
    entitlement: "player_plus",
    safetyKey: null,
  },
  {
    key: "public_reels",
    label: "Public highlight feed",
    description: "Sharing a reel to the public feed. Free forever.",
    tier: "alwaysFree",
    entitlement: "player_plus",
    safetyKey: "public_reels",
  },

  // ------------------------------------------------------------------ safety
  {
    key: "text_moderation",
    label: "Text moderation",
    description: "Safety scanning of written content. Never priceable.",
    tier: "safety",
    entitlement: "player_plus",
    safetyKey: null,
  },
  {
    key: "image_moderation",
    label: "Image moderation",
    description: "Safety scanning of images and video frames. Never priceable.",
    tier: "safety",
    entitlement: "player_plus",
    safetyKey: null,
  },
];

const BY_KEY = new Map(FEATURE_REGISTRY.map((f) => [f.key, f]));

export function featureFor(key: string): MonetizableFeature | null {
  return BY_KEY.get(key) ?? null;
}

/** Only these may carry a `premium` or `disabled` setting. */
export function isConfigurable(feature: MonetizableFeature): boolean {
  return feature.tier === "gateable";
}

export const GATEABLE_FEATURES = FEATURE_REGISTRY.filter(isConfigurable);
