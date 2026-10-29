import { gameAgeRangeIsAdultOnly } from "@/lib/city-seo";
import type { AgeRequirement } from "@/lib/game-age";

export type PublicDiscoveryKind =
  "unset" | "eligible" | "no_minimum" | "includes_minors" | "invalid";

/**
 * What the host's age range means for anonymous public discovery. The rule itself is
 * `gameAgeRangeIsAdultOnly` (city-seo), which mirrors the database policy; this only words
 * the result. It is explanation, not enforcement: the database decides what a visitor sees,
 * and a game must also be public, not hidden and not cancelled.
 */
export function publicDiscoveryNote(req: AgeRequirement | null | undefined): {
  kind: PublicDiscoveryKind;
  text: string;
} {
  const min = req?.minAge ?? null;
  const max = req?.maxAge ?? null;
  const advice = "Choose the range that matches who you want to play.";

  if (min === null && max === null) {
    return {
      kind: "unset",
      text: `No age requirement set. You can still create this game, but it won't appear in public discovery for signed-out visitors. ${advice}`,
    };
  }
  if (min !== null && max !== null && max < min) {
    return {
      kind: "invalid",
      text: "Check the minimum and maximum: the maximum is below the minimum.",
    };
  }
  if (gameAgeRangeIsAdultOnly({ min_age: min, max_age: max })) {
    return {
      kind: "eligible",
      text: `This is an adult-only range, so the game can appear in public discovery for signed-out visitors, as long as it is public and is not hidden or cancelled by you or your organization. ${advice}`,
    };
  }
  if (min === null) {
    return {
      kind: "no_minimum",
      text: `No minimum age is set, so this game won't appear in public discovery for signed-out visitors. ${advice}`,
    };
  }
  return {
    kind: "includes_minors",
    text: `This range includes people under 18, so the game won't appear in public discovery for signed-out visitors. ${advice}`,
  };
}
