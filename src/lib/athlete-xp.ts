/**
 * Athlete Level & XP rules. Pure so the server and tests share one source.
 * XP only comes from host-verified activity; no-shows and late cancels never
 * subtract XP — they lower the reliability score instead.
 */
export const XP_RULES = { attendedRun: 100, hostedGame: 150, attendedTryout: 200 } as const;
export const XP_PER_LEVEL = 500;

export type AthleteProgressInput = {
  attendedRuns: number;
  hostedGames: number;
  attendedTryouts: number;
  noShows: number;
  lateCancels: number;
  /** Host-marked attendance, newest first (true = showed up). */
  attendanceHistory: boolean[];
};

export type AthleteBadge = { id: string; label: string; emoji: string; hint: string };

export type AthleteProgress = {
  xp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number;
  gamesPlayed: number;
  totalRunsCompleted: number;
  currentStreak: number;
  reliability: number | null;
  reliabilityTier: "Elite" | "Reliable" | "Steady" | "Needs work" | "New";
  badges: AthleteBadge[];
};

export function computeAthleteProgress(i: AthleteProgressInput): AthleteProgress {
  const xp =
    i.attendedRuns * XP_RULES.attendedRun +
    i.hostedGames * XP_RULES.hostedGame +
    i.attendedTryouts * XP_RULES.attendedTryout;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  let currentStreak = 0;
  for (const showed of i.attendanceHistory) {
    if (!showed) break;
    currentStreak++;
  }
  const commitments = i.attendedRuns + i.noShows + i.lateCancels;
  const reliability = commitments >= 3 ? Math.round((i.attendedRuns / commitments) * 100) : null;
  const reliabilityTier =
    reliability == null
      ? "New"
      : reliability >= 95
        ? "Elite"
        : reliability >= 85
          ? "Reliable"
          : reliability >= 70
            ? "Steady"
            : "Needs work";

  const badges: AthleteBadge[] = [];
  const add = (ok: boolean, b: AthleteBadge) => ok && badges.push(b);
  add(i.attendedRuns >= 1, { id: "first-run", label: "First Run", emoji: "🏁", hint: "Completed a first run" });
  add(i.attendedRuns >= 10, { id: "runs-10", label: "10 Runs", emoji: "🔟", hint: "10 runs completed" });
  add(i.attendedRuns >= 25, { id: "runs-25", label: "25 Runs", emoji: "🔥", hint: "25 runs completed" });
  add(i.attendedRuns >= 50, { id: "runs-50", label: "50 Runs", emoji: "🏆", hint: "50 runs completed" });
  add(currentStreak >= 5, { id: "streak-5", label: "Iron Streak", emoji: "⛓️", hint: "5 runs in a row" });
  add(reliability != null && reliability >= 95 && commitments >= 10, {
    id: "reliable",
    label: "Always Shows",
    emoji: "✅",
    hint: "95%+ reliability over 10+ runs",
  });
  add(i.hostedGames >= 1, { id: "host", label: "Host", emoji: "📣", hint: "Hosted a game" });
  add(i.attendedTryouts >= 1, { id: "tryout", label: "Tryout Ready", emoji: "🎯", hint: "Attended a verified tryout" });

  return {
    xp,
    level,
    levelXp: xp % XP_PER_LEVEL,
    nextLevelXp: XP_PER_LEVEL,
    gamesPlayed: i.attendedRuns,
    totalRunsCompleted: i.attendedRuns,
    currentStreak,
    reliability,
    reliabilityTier,
    badges,
  };
}

/**
 * What a minor's guardian can choose to show on the public Player Card. An
 * allow-list: level, the XP bar and milestone badges only. Streaks, reliability,
 * attendance counts and anything dated or located are never in it. The badges kept
 * are the milestone ones; "Iron Streak" and "Always Shows" describe routine and
 * attendance, so they stay off.
 */
export const PUBLIC_XP_BADGE_IDS = ["first-run", "runs-10", "runs-25", "runs-50", "host", "tryout"];

export type PublicXp = {
  xp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number;
  badges: AthleteBadge[];
};

export function toPublicXp(p: AthleteProgress): PublicXp {
  return {
    xp: p.xp,
    level: p.level,
    levelXp: p.levelXp,
    nextLevelXp: p.nextLevelXp,
    badges: p.badges
      .filter((b) => PUBLIC_XP_BADGE_IDS.includes(b.id))
      .map((b) => ({ id: b.id, label: b.label, emoji: b.emoji, hint: b.hint })),
  };
}
