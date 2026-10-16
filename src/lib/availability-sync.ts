import { miToKm } from "@/lib/distance";
import { levelTiers, serializeSkillTiers, ANY_SKILL, type SportLevel } from "@/lib/sport-levels";
import {
  listMyAvailabilities,
  updateAvailability,
  type PlayerAvailability,
} from "@/lib/availability";
import { buildSkillFields, parsePostSkillLevels } from "@/lib/availability-levels";

export type ProfileSyncInput = {
  /** Favorite sports with their per-sport level, straight from the profile form. */
  sports: { name: string; level?: SportLevel | null }[];
  city?: string | null;
  /** Location preference in miles. */
  searchRadiusMi?: number | null;
};

/**
 * The patch a single open post needs so it mirrors the profile again.
 * Returns null when nothing would change.
 */
export function availabilityPatchFromProfile(
  post: Pick<
    PlayerAvailability,
    | "sports"
    | "skill_level"
    | "city"
    | "formatted_address"
    | "place_id"
    | "lat"
    | "lng"
    | "travel_radius_km"
  > & { skill_levels?: unknown },
  input: ProfileSyncInput,
): Partial<PlayerAvailability> | null {
  const patch: Partial<PlayerAvailability> = {};

  // Sports: drop what the profile no longer lists; fall back to the profile's
  // full set when that would leave the post empty.
  const profileSports = input.sports.map((s) => s.name);
  if (profileSports.length) {
    const kept = (post.sports ?? []).filter((s) => profileSports.includes(s));
    const nextSports = kept.length ? kept : profileSports;
    if (JSON.stringify(nextSports) !== JSON.stringify(post.sports ?? [])) {
      patch.sports = nextSports;
    }
  }

  // Skill: levels the player picked on the post itself stay; otherwise the
  // profile level for the post's primary sport wins.
  const finalSports = patch.sports ?? post.sports ?? [];
  const postLevels = parsePostSkillLevels(post.skill_levels, finalSports);
  const primary = finalSports[0] ?? null;
  const level = input.sports.find((s) => s.name === primary)?.level ?? null;
  const explicit = primary ? postLevels[primary] : undefined;
  const nextSkill = explicit
    ? serializeSkillTiers(primary, explicit)
    : level
      ? serializeSkillTiers(primary, levelTiers(level))
      : ANY_SKILL;
  if (nextSkill !== post.skill_level) patch.skill_level = nextSkill;
  // Drop picked levels for sports the post no longer lists.
  if (patch.sports && post.skill_levels && typeof post.skill_levels === "object") {
    const before = Object.keys(post.skill_levels as Record<string, unknown>).length;
    if (Object.keys(postLevels).length !== before) {
      patch.skill_levels = buildSkillFields(finalSports, postLevels).skill_levels;
    }
  }

  // Location: keep the city text aligned, and only drop the saved Places
  // details when they no longer belong to the new city.
  const city = (input.city ?? "").trim();
  if (city && city !== (post.city ?? "")) {
    patch.city = city;
    const addr = (post.formatted_address ?? "").toLowerCase();
    if (addr && !addr.includes(city.toLowerCase())) {
      patch.place_id = null;
      patch.formatted_address = null;
      patch.lat = null;
      patch.lng = null;
    }
  }

  if (input.searchRadiusMi != null) {
    const km = Math.max(1, Math.round(miToKm(input.searchRadiusMi)));
    if (km !== post.travel_radius_km) patch.travel_radius_km = km;
  }

  return Object.keys(patch).length ? patch : null;
}

/**
 * Mirrors profile changes (sports, skill level, location) onto the viewer's
 * open availability posts so they never advertise stale details.
 * Best-effort: failures are logged, never surfaced as a profile save error.
 */
export async function syncAvailabilitiesFromProfile(input: ProfileSyncInput): Promise<number> {
  try {
    const rows = await listMyAvailabilities();
    const open = rows.filter((r) => r.status === "open");
    if (!open.length) return 0;
    let updated = 0;
    for (const post of open) {
      const patch = availabilityPatchFromProfile(post, input);
      if (!patch) continue;
      await updateAvailability(post.id, patch);
      updated += 1;
    }
    return updated;
  } catch (e) {
    console.warn("availability sync from profile failed", e);
    return 0;
  }
}
