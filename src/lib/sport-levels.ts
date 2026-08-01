import type { Sport } from "@/lib/sample-data";

/**
 * A player's rating in one sport.
 * `tier` is the primary (highest) tier and is what filters compare against.
 * `tiers` holds every selected tier on sports that allow more than one
 * (Football, where a player can be both "Flag Rec" and "7v7 Elite").
 */
export type SportLevel = { system: string; tier: string; tiers?: string[] };

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
  /** Allows selecting more than one tier (e.g. one per Football format). */
  multi?: boolean;
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
/** Shared sub-level ladder used by every football format. */
const FOOTBALL_SUB_TIERS = ["Rec", "Competitive", "Showcase / Travel", "Elite"] as const;
const FOOTBALL_FORMATS = ["Flag", "7v7", "Full contact"] as const;

const FOOTBALL_GROUPS = FOOTBALL_FORMATS.map((format) => ({
  label: format,
  tiers: FOOTBALL_SUB_TIERS.map((t) => `${format} ${t}`),
}));

const FOOTBALL_TIERS = FOOTBALL_GROUPS.flatMap((g) => g.tiers);

/** Retired Football tiers mapped forward to the format-prefixed ladder. */
const LEGACY_TIER_ALIASES: Record<string, string> = {
  "High School": "Full contact Competitive",
  College: "Full contact Showcase / Travel",
  "Semi-Pro": "Full contact Elite",
};

export const LEVELS_BY_SPORT: Record<Sport, SportScale> = {
  Baseball: { system: "MiLB", tiers: BALL_TIERS, hint: "Highest level you've played." },
  Softball: { system: "MiLB", tiers: BALL_TIERS, hint: "Highest level you've played." },
  Basketball: {
    system: "Level",
    tiers: ["Rec", "High School", "AAU / Travel", "College", "Semi-Pro", "Pro"],
  },
  Football: {
    system: "Level",
    tiers: FOOTBALL_TIERS,
    groups: FOOTBALL_GROUPS,
    multi: true,
    hint: "Pick a level in each format you play — you can choose more than one.",
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

/** Every tier on a level, primary first. */
export function levelTiers(level?: SportLevel | null): string[] {
  if (!level?.tier) return [];
  const all = level.tiers?.length ? level.tiers : [level.tier];
  return Array.from(new Set([level.tier, ...all]));
}

/** "3.5 NTRP", "Minor AAA", "Flag Rec · 7v7 Elite" — scale name only for pure ratings. */
export function formatSportLevel(level?: SportLevel | null): string | null {
  const tiers = levelTiers(level);
  if (!tiers.length) return null;
  const label = (tier: string) => {
    const numeric = /^[0-9]+(\.[0-9]+)?$/.test(tier);
    return numeric && level?.system ? `${tier} ${level.system}` : tier;
  };
  return tiers.map(label).join(" · ");
}

/** Orders tiers the way the sport's scale does, easiest first. */
function orderTiers(sport: string | null | undefined, tiers: string[]): string[] {
  const scale = sport ? scaleForSport(sport as Sport) : GENERIC_SCALE;
  const rank = (t: string) => {
    const i = scale.tiers.indexOf(t);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...tiers].sort((a, b) => rank(a) - rank(b));
}

/**
 * Adds or removes a tier from a level, honouring the sport's `multi` flag.
 * Returns null when nothing is selected any more.
 */
export function toggleSportTier(
  sport: Sport,
  level: SportLevel | null | undefined,
  tier: string,
): SportLevel | null {
  const scale = scaleForSport(sport);
  const current = levelTiers(level);
  if (!scale.multi) {
    return current.includes(tier) ? null : { system: scale.system, tier };
  }
  const next = orderTiers(
    sport,
    current.includes(tier) ? current.filter((t) => t !== tier) : [...current, tier],
  );
  if (!next.length) return null;
  // Primary = highest selected tier, so single-value filters stay meaningful.
  return { system: scale.system, tier: next[next.length - 1], tiers: next };
}

/** Maps a retired tier onto its current equivalent for a sport. */
export function migrateTier(sport: string | null | undefined, tier: string): string {
  if (sport !== "Football") return tier;
  return LEGACY_TIER_ALIASES[tier] ?? tier;
}

/** Reads the `profiles.sport_levels` jsonb map into typed entries. */
export function parseSportLevels(raw: unknown): Record<string, SportLevel> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SportLevel> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as { system?: unknown; tier?: unknown };
    if (typeof v.tier !== "string" || !v.tier) continue;
    const raw = Array.isArray((v as { tiers?: unknown }).tiers)
      ? ((v as { tiers: unknown[] }).tiers.filter((t) => typeof t === "string" && t) as string[])
      : [];
    const tiers = orderTiers(
      name,
      Array.from(new Set([v.tier, ...raw].map((t) => migrateTier(name, t)))),
    );
    out[name] = {
      system: typeof v.system === "string" ? v.system : "",
      tier: tiers[tiers.length - 1] ?? migrateTier(name, v.tier),
      ...(tiers.length > 1 ? { tiers } : {}),
    };
  }
  return out;
}


/** Builds the jsonb map written to `profiles.sport_levels`. */
export function serializeSportLevels(
  sports: { name: Sport; level?: SportLevel | null }[],
): Record<string, SportLevel> {
  const out: Record<string, SportLevel> = {};
  for (const s of sports) {
    if (!s.level?.tier) continue;
    const tiers = orderTiers(s.name, levelTiers(s.level));
    out[s.name] = {
      system: s.level.system || scaleForSport(s.name).system,
      tier: tiers[tiers.length - 1],
      ...(tiers.length > 1 ? { tiers } : {}),
    };
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
  const migrated = migrateTier(sport, skill);
  return filterTiersForSport(sport || "").includes(migrated) ? migrated : "";
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
    return { system: "", tier: migrateTier(sport, fallbackSkill) };
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
  if (sports.some((s) => levelTiers(levels[s]).includes(wanted))) return true;
  const hasProfileLevel = sports.some((s) => levels[s]?.tier);
  // Only fall back to the post's own generic value when the profile is silent.
  return !hasProfileLevel && fallbackSkill === wanted;
}
