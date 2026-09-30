/**
 * Copy helpers for the reels dashboard: title suggestions offered before an
 * upload, sample on-screen text for the style preview, and the post text an
 * athlete copies out to share.
 *
 * Suggestions are built only from facts the page already knows (linked game,
 * sport, date, chosen vibe). The AI has not seen the footage yet at upload
 * time, so nothing here names a play it could be wrong about.
 */

import type { ReelOverlayTheme, ReelVibe } from "@/lib/reel-style";

const VIBE_COPY: Record<ReelVibe, { noun: string; tag: string }> = {
  hype: { noun: "highlights", tag: "Best plays" },
  cinematic: { noun: "film", tag: "Moments" },
  broadcast: { noun: "recap", tag: "Play of the day" },
  documentary: { noun: "story", tag: "Behind the plays" },
};

const TITLE_MAX = 120;

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Up to three title ideas for the next upload, most specific first. Tapping one
 * fills the title field; the athlete can still edit it.
 */
export function suggestReelTitles(input: {
  sport?: string | null;
  gameTitle?: string | null;
  /** When the footage was shot — the linked game's date, when known. */
  date?: Date | string | null;
  vibe?: ReelVibe | null;
}): string[] {
  const { noun, tag } = VIBE_COPY[input.vibe ?? "hype"] ?? VIBE_COPY.hype;
  const sport = String(input.sport ?? "").trim();
  const sportWord = sport ? sport.toLowerCase() : "pickup";
  const game = String(input.gameTitle ?? "").trim();
  const date = asDate(input.date);

  const ideas: string[] = [];
  if (game) ideas.push(`${game} ${noun}`);
  if (date) {
    const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
    ideas.push(`${weekday} ${sportWord} ${noun}`);
  }
  ideas.push(`${capitalize(sportWord)} · ${tag}`);
  if (date) {
    const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    ideas.push(`${capitalize(sportWord)} ${noun} · ${day}`);
  } else {
    ideas.push(`My ${sportWord} ${noun}`);
  }

  const seen = new Set<string>();
  return ideas
    .map((t) => t.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX))
    .filter((t) => {
      const key = t.toLowerCase();
      if (!t || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

/** A typical play per sport: the full call and a two-word version. */
const SPORT_PLAY: Record<string, { full: string; short: string }> = {
  basketball: { full: "fast break bucket", short: "fast break" },
  soccer: { full: "top corner finish", short: "top corner" },
  football: { full: "sideline catch", short: "sideline catch" },
  baseball: { full: "line drive to the gap", short: "line drive" },
  softball: { full: "line drive to the gap", short: "line drive" },
  volleyball: { full: "cross court kill", short: "kill shot" },
  tennis: { full: "passing shot winner", short: "passing shot" },
  pickleball: { full: "kitchen put away", short: "put away" },
  running: { full: "final kick", short: "final kick" },
};

/**
 * Example card text for the style preview, written the way each overlay theme
 * asks the AI to write (see OVERLAY_THEME_OPTIONS). Illustration only — the
 * real cards come from the footage.
 */
export function sampleOverlayText(theme: ReelOverlayTheme, sport?: string | null): string {
  const sportKey = String(sport ?? "").toLowerCase();
  const play = SPORT_PLAY[sportKey] ?? { full: "key play", short: "key play" };
  switch (theme) {
    case "scoreboard":
      return sportKey ? `${sportKey} · ${play.full}` : play.full;
    case "minimal":
      return play.short;
    case "bold":
      return `${play.short}!`;
    case "retro":
      return play.full.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    default:
      return "";
  }
}

/** Caption plus hashtags, ready to paste into a post. */
export function formatPostCopy(caption?: string | null, hashtags?: string[] | null): string {
  const tags = (hashtags ?? [])
    .map((h) => String(h).replace(/^#/, "").trim())
    .filter(Boolean)
    .map((h) => `#${h}`)
    .join(" ");
  return [String(caption ?? "").trim(), tags].filter(Boolean).join("\n\n");
}
