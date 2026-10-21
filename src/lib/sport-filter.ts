import type { Sport } from "@/lib/sample-data";
import {
  levelMatchesFilter,
  sanitizeSkillForSport,
  scaleForSport,
  GENERIC_SCALE,
  parseSkillTiers,
  serializeSkillTiers,
} from "@/lib/sport-levels";

/**
 * Multi-sport filter state shared by every browse surface (Feed, Players,
 * Available Players, Teams, Trainers).
 *
 * URL/localStorage format:
 *  - `sport=Baseball,Football`            — comma separated list
 *  - `skill=Baseball:College / Adult Competitive|Football:7v7 Travel / Showcase · Flag Rec`
 *                                         — per-sport tiers, "|" between sports
 *  - `skill=Advanced`                     — legacy flat value; applies to the
 *                                           first selected sport
 */

export type SportSkillMap = Record<string, string>;

const SPORT_SEP = ",";
const ENTRY_SEP = "|";
const KV_SEP = ":";

/** Parses the `sport` search param into a de-duplicated list. */
export function parseSportList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(SPORT_SEP)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** Serializes a sport list back into the `sport` search param. */
export function serializeSportList(sports: string[]): string {
  return Array.from(new Set(sports.filter(Boolean))).join(SPORT_SEP);
}

/** Toggles one sport in/out of the selection (null/"" clears everything). */
export function toggleSport(sports: string[], sport: string | null): string[] {
  if (!sport) return [];
  return sports.includes(sport) ? sports.filter((s) => s !== sport) : [...sports, sport];
}

/**
 * Parses the `skill` search param into a per-sport map, dropping any tier the
 * sport's own scale doesn't have (so a stale URL or preset can never stick).
 */
export function parseSportSkillMap(
  raw: string | null | undefined,
  sports: string[],
): SportSkillMap {
  const out: SportSkillMap = {};
  if (!raw) return out;
  const entries = raw
    .split(ENTRY_SEP)
    .map((e) => e.trim())
    .filter(Boolean);
  const legacy: string[] = [];
  for (const entry of entries) {
    const idx = entry.indexOf(KV_SEP);
    if (idx === -1) {
      legacy.push(entry);
      continue;
    }
    const sport = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!sports.includes(sport)) continue;
    const kept = serializeTiersForSport(sport, parseSkillTiers(sport, value));
    if (kept) out[sport] = kept;
  }
  // Legacy flat value ("skill=Advanced"): apply to the first selected sport.
  if (legacy.length && sports.length) {
    const first = sports[0]!;
    if (!out[first]) {
      const kept = serializeTiersForSport(first, parseSkillTiers(first, legacy.join(" · ")));
      if (kept) out[first] = kept;
    }
  }
  return out;
}

/** Serializes a per-sport skill map back into the `skill` search param. */
export function serializeSportSkillMap(map: SportSkillMap, sports: string[]): string {
  return sports
    .filter((s) => map[s])
    .map((s) => `${s}${KV_SEP}${map[s]}`)
    .join(ENTRY_SEP);
}

/** Drops entries for sports no longer selected, and invalid tiers. */
export function sanitizeSportSkillMap(map: SportSkillMap, sports: string[]): SportSkillMap {
  const out: SportSkillMap = {};
  for (const sport of sports) {
    const value = map[sport];
    if (!value) continue;
    const kept = serializeTiersForSport(sport, parseSkillTiers(sport, value));
    if (kept) out[sport] = kept;
  }
  return out;
}

/** Number of active skill selections (used for filter badges). */
export function countSkillSelections(map: SportSkillMap): number {
  return Object.values(map).filter(Boolean).length;
}

/**
 * Toggles one tier for one sport, honouring the sport's `multi` flag exactly
 * like the profile Sports editor does.
 */
export function toggleSportSkillTier(
  map: SportSkillMap,
  sport: string,
  tier: string,
): SportSkillMap {
  const scale = sport ? scaleForSport(sport as Sport) : GENERIC_SCALE;
  const current = parseSkillTiers(sport, map[sport]);
  const next = scale.multi
    ? current.includes(tier)
      ? current.filter((t) => t !== tier)
      : [...current, tier]
    : current.includes(tier)
      ? []
      : [tier];
  const out = { ...map };
  const value = serializeTiersForSport(sport, next);
  if (value) out[sport] = value;
  else delete out[sport];
  return out;
}

/** Tiers currently selected for a sport. */
export function selectedTiersForSport(map: SportSkillMap, sport: string): string[] {
  return parseSkillTiers(sport, map[sport]);
}

function serializeTiersForSport(sport: string, tiers: string[]): string {
  const valid = tiers
    .map((t) => sanitizeSkillForSport(sport, t))
    .filter((t): t is string => Boolean(t));
  if (!valid.length) return "";
  const serialized = serializeSkillTiers(sport, valid);
  return serialized === "All Levels" ? "" : serialized;
}

/**
 * True when an availability post (or player) satisfies the multi-sport filter:
 * it must list at least one selected sport, and where that sport has picked
 * tiers, the author's level for it must match one of them.
 */
export function matchesSportSkillFilter(
  authorSportLevels: unknown,
  postSports: string[],
  postSkill: string | null | undefined,
  sports: string[],
  skills: SportSkillMap,
  /**
   * Tiers the post itself picked for a sport. These always count, alongside
   * the author's profile tier, because the player chose them for this post.
   */
  postTiers?: (sport: string) => string[],
): boolean {
  const postHas = (sportList: string[], tier: string) =>
    !!postTiers && sportList.some((s) => postTiers(s).includes(tier));
  if (sports.length === 0) {
    const wantedAny = Object.values(skills).flatMap((v) => v.split(/·/).map((t) => t.trim()));
    if (wantedAny.length === 0) return true;
    return wantedAny.some(
      (w) => postHas(postSports, w) || levelMatchesFilter(authorSportLevels, postSports, postSkill, w),
    );
  }
  const overlap = sports.filter((s) => postSports.some((p) => p.toLowerCase() === s.toLowerCase()));
  if (overlap.length === 0) return false;
  const constrained = overlap.filter((s) => skills[s]);
  if (constrained.length === 0) return true;
  // Any selected sport whose tier matches is enough (OR across sports).
  return constrained.some((s) =>
    selectedTiersForSport(skills, s).some(
      (tier) => postHas([s], tier) || levelMatchesFilter(authorSportLevels, [s], postSkill, tier),
    ),
  );
}

/** True when an org/team covering `orgSports` matches the sport selection. */
export function matchesSportList(orgSports: string[], sports: string[]): boolean {
  if (sports.length === 0) return true;
  return orgSports.some((o) => sports.some((s) => s.toLowerCase() === o.toLowerCase()));
}
