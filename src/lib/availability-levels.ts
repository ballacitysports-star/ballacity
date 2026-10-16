/**
 * Competitive levels and intent ("guest" / "trying out") on a player
 * availability post.
 *
 * `skill_levels` holds every listed sport's chosen tiers as a serialized skill
 * string (the same " · " format `skill_level` uses). `skill_level` keeps the
 * primary sport's tiers so existing readers and filters keep working.
 */
import { ANY_SKILL, parseSkillTiers, serializeSkillTiers } from "./sport-levels";

export const AVAILABILITY_INTENTS = ["guest", "tryout"] as const;
export type AvailabilityIntent = (typeof AVAILABILITY_INTENTS)[number];

export const INTENT_LABEL: Record<AvailabilityIntent, string> = {
  guest: "Guest player",
  tryout: "Trying out",
};

export const INTENT_BLURB: Record<AvailabilityIntent, string> = {
  guest: "Fill in for a team or game as a guest",
  tryout: "Looking to try out and join a team",
};

/** Mirrors the 120-character cap the database puts on `skill_level`. */
const SKILL_LEVEL_MAX = 120;

export function parseIntents(raw: unknown): AvailabilityIntent[] {
  if (!Array.isArray(raw)) return [];
  return AVAILABILITY_INTENTS.filter((i) => raw.includes(i));
}

/** Tiers per sport from the stored `skill_levels` jsonb, limited to `sports`. */
export function parsePostSkillLevels(raw: unknown, sports: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const sport of sports) {
    const value = (raw as Record<string, unknown>)[sport];
    const tiers = typeof value === "string" ? parseSkillTiers(sport, value) : [];
    if (tiers.length) out[sport] = tiers;
  }
  return out;
}

/**
 * Tiers the post itself lists for a sport. Falls back to the legacy
 * `skill_level` for the primary sport on posts saved before `skill_levels`.
 */
export function postTiersForSport(
  post: { sports: string[]; skill_level: string | null; skill_levels?: unknown },
  sport: string,
): string[] {
  const explicit = parsePostSkillLevels(post.skill_levels, [sport])[sport];
  if (explicit) return explicit;
  return sport === post.sports[0] ? parseSkillTiers(sport, post.skill_level) : [];
}

/** Columns to save for the chosen sports and their tiers. */
export function buildSkillFields(
  sports: string[],
  levels: Record<string, string[]>,
): { skill_level: string; skill_levels: Record<string, string> } {
  const skill_levels: Record<string, string> = {};
  for (const sport of sports) {
    const value = serializeSkillTiers(sport, levels[sport] ?? []);
    if (value !== ANY_SKILL) skill_levels[sport] = value;
  }
  const primary = sports[0];
  let tiers = primary ? parseSkillTiers(primary, skill_levels[primary]) : [];
  let skill_level = serializeSkillTiers(primary, tiers);
  while (skill_level.length > SKILL_LEVEL_MAX && tiers.length > 1) {
    tiers = tiers.slice(0, -1);
    skill_level = serializeSkillTiers(primary, tiers);
  }
  return { skill_level, skill_levels };
}

/** Initial per-sport tier selection for the post editor. */
export function initialLevelsForPost(post: {
  sports: string[];
  skill_level: string | null;
  skill_levels?: unknown;
}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const sport of post.sports) {
    const tiers = postTiersForSport(post, sport);
    if (tiers.length) out[sport] = tiers;
  }
  return out;
}
