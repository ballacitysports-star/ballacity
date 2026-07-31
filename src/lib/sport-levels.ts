import type { Sport } from "@/lib/sample-data";

/** A named tier inside a sport's rating scale. */
export type SportLevel = { system: string; tier: string };

export type SportScale = {
  /** Short scale name shown next to the tier, e.g. "NTRP", "MiLB". */
  system: string;
  /** Ordered tiers, easiest first. */
  tiers: string[];
  /** Optional helper copy under the chips. */
  hint?: string;
  /**
   * Optional grouping of `tiers` by format (e.g. Football's Flag / 7v7 /
   * Full contact). Purely presentational — the union of every group's tiers
   * must equal `tiers`, so filters and storage keep using flat tier strings.
   */
  groups?: { label: string; tiers: string[] }[];
};


/** Generic fallback used by any sport without a curated scale. */
export const GENERIC_SCALE: SportScale = {
  system: "Self-rated",
  tiers: ["Beginner", "Intermediate", "Advanced", "Pro"],
};

const BALL_TIERS = [
  "Rec",
  "Little League",
  "High School",
  "Travel / Showcase",
  "College",
  "Minor A",
  "Minor AA",
  "Minor AAA",
  "Major",
  "National",
];

export const LEVELS_BY_SPORT: Record<Sport, SportScale> = {
  Baseball: { system: "MiLB", tiers: BALL_TIERS, hint: "Highest level you've played." },
  Softball: { system: "MiLB", tiers: BALL_TIERS, hint: "Highest level you've played." },
  Basketball: {
    system: "Level",
    tiers: ["Rec", "High School", "AAU / Travel", "College", "Semi-Pro", "Pro"],
  },
  Football: {
    system: "Level",
    tiers: ["Flag Rec", "Flag Competitive", "High School", "College", "Semi-Pro"],
  },
  Soccer: {
    system: "Level",
    tiers: ["Rec", "High School", "Club / Travel", "College", "Semi-Pro", "Pro"],
  },
  Tennis: {
    system: "NTRP",
    tiers: ["1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0", "7.0"],
    hint: "USTA NTRP rating.",
  },
  Pickleball: {
    system: "DUPR",
    tiers: ["2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0"],
    hint: "DUPR rating.",
  },
  Volleyball: { system: "USAV", tiers: ["Rec", "B", "BB", "A", "AA", "Open"] },
  Running: {
    system: "Pace",
    tiers: ["10:00+/mi", "9:00/mi", "8:00/mi", "7:00/mi", "6:00/mi", "sub-6:00/mi"],
    hint: "Typical race pace.",
  },
};

export function scaleForSport(sport: Sport): SportScale {
  return LEVELS_BY_SPORT[sport] ?? GENERIC_SCALE;
}

export function levelsForSport(sport: Sport): string[] {
  return scaleForSport(sport).tiers;
}

/** "3.5 NTRP", "Minor AAA", "Advanced" — scale name appended only when numeric. */
export function formatSportLevel(level?: SportLevel | null): string | null {
  if (!level?.tier) return null;
  const numeric = /^[0-9]/.test(level.tier);
  return numeric && level.system ? `${level.tier} ${level.system}` : level.tier;
}

/** Reads the `profiles.sport_levels` jsonb map into typed entries. */
export function parseSportLevels(raw: unknown): Record<string, SportLevel> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SportLevel> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as { system?: unknown; tier?: unknown };
    if (typeof v.tier !== "string" || !v.tier) continue;
    out[name] = { system: typeof v.system === "string" ? v.system : "", tier: v.tier };
  }
  return out;
}

/** Builds the jsonb map written to `profiles.sport_levels`. */
export function serializeSportLevels(
  sports: { name: Sport; level?: SportLevel | null }[],
): Record<string, SportLevel> {
  const out: Record<string, SportLevel> = {};
  for (const s of sports) {
    if (s.level?.tier) out[s.name] = { system: s.level.system || scaleForSport(s.name).system, tier: s.level.tier };
  }
  return out;
}

/** Legacy generic tiers still stored on older availability posts. */
export const LEGACY_SKILLS = ["Beginner", "Intermediate", "Advanced"] as const;

/** Tiers a skill filter may legally hold for a sport ("" = all sports). */
export function filterTiersForSport(sport: string): string[] {
  return sport ? levelsForSport(sport as Sport) : [...LEGACY_SKILLS];
}

/**
 * Keeps a skill filter value only when the sport's own scale contains it.
 * Used everywhere a sport/skill pair can arrive from outside the UI
 * (URL, localStorage, saved presets) so an incompatible tier can never stick.
 */
export function sanitizeSkillForSport(
  sport: string | null | undefined,
  skill: string | null | undefined,
): string {
  if (!skill) return "";
  return filterTiersForSport(sport || "").includes(skill) ? skill : "";
}


/**
 * Skill level to show for a player in a given sport.
 * Profile tier wins; falls back to the post's own generic level.
 */
export function resolvePlayerLevel(
  rawSportLevels: unknown,
  sport: string | null | undefined,
  fallbackSkill?: string | null,
): SportLevel | null {
  const levels = parseSportLevels(rawSportLevels);
  if (sport && levels[sport]) return levels[sport];
  if (fallbackSkill && fallbackSkill !== "All Levels") {
    return { system: "", tier: fallbackSkill };
  }
  return null;
}

/** Every profile tier the player has, limited to the sports on the post. */
export function playerLevelsForSports(
  rawSportLevels: unknown,
  sports: string[],
): { sport: string; level: SportLevel }[] {
  const levels = parseSportLevels(rawSportLevels);
  return sports
    .filter((s) => levels[s]?.tier)
    .map((s) => ({ sport: s, level: levels[s] }));
}

/** True when a resolved level matches a chosen filter tier. */
export function levelMatchesFilter(
  rawSportLevels: unknown,
  sports: string[],
  fallbackSkill: string | null | undefined,
  wanted: string,
): boolean {
  if (!wanted) return true;
  const levels = parseSportLevels(rawSportLevels);
  if (sports.some((s) => levels[s]?.tier === wanted)) return true;
  const hasProfileLevel = sports.some((s) => levels[s]?.tier);
  // Only fall back to the post's own generic value when the profile is silent.
  return !hasProfileLevel && fallbackSkill === wanted;
}
