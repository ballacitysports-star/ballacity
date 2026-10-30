import { SPORTS, type Sport } from "@/lib/sample-data";
import { SPORT_GUIDES, guideBySlug } from "@/lib/sports-guide";

/**
 * Sport hubs: one public page per sport at /<slug>.
 *
 * There is no sport list here. Sports and slugs come from the canonical
 * `SPORTS` / sports-guide definitions, so a new sport gets a hub with a
 * generic headline until copy is written for it below.
 */
export type SportHub = {
  slug: string;
  sport: Sport;
  emoji: string;
  headline: string;
  subhead: string;
};

const HEADLINES: Partial<Record<Sport, { headline: string; subhead: string }>> = {
  Basketball: {
    headline: "Find Your Next Run.",
    subhead: "Pickup basketball, courts and teams near you.",
  },
  Baseball: {
    headline: "Find Your Team. Build Your Game.",
    subhead: "Teams, tryouts, coaches and baseball games in one place.",
  },
  Soccer: {
    headline: "Your Next Match Starts Here.",
    subhead: "Pickup soccer, local teams and community matches.",
  },
  Pickleball: {
    headline: "Find Your Court Crew.",
    subhead: "Pickleball games, partners and groups near you.",
  },
  Volleyball: {
    headline: "Find Your Squad.",
    subhead: "Pickup volleyball, open gyms, teams and players.",
  },
};

const EMOJI = new Map(SPORTS.map((s) => [s.name, s.emoji]));

export const SPORT_HUBS: SportHub[] = SPORT_GUIDES.map((g) => {
  const copy = HEADLINES[g.sport as Sport];
  return {
    slug: g.slug,
    sport: g.sport as Sport,
    emoji: EMOJI.get(g.sport as Sport) ?? "🏟️",
    headline: copy?.headline ?? `Find ${g.sport} Near You.`,
    subhead: copy?.subhead ?? `${g.sport} games, teams and players in your area.`,
  };
});

export const SPORT_HUB_SLUGS = SPORT_HUBS.map((h) => h.slug);

/** The hub for a URL slug (any case), or undefined for anything that is not a sport. */
export function hubBySlug(slug: string): SportHub | undefined {
  const guide = guideBySlug(slug);
  return guide ? SPORT_HUBS.find((h) => h.slug === guide.slug) : undefined;
}

/**
 * True only for exactly `/<sport slug>` (an optional trailing slash). The hubs
 * are public pages, so the app shell must not send a signed-out visitor to sign
 * in. Nothing deeper and no other path is matched.
 */
export function isSportHubPath(pathname: string): boolean {
  const m = /^\/([a-z]+)\/?$/.exec(pathname);
  return m ? hubBySlug(m[1]) !== undefined : false;
}

export function hubForSport(sport: string): SportHub | undefined {
  return SPORT_HUBS.find((h) => h.sport.toLowerCase() === sport.toLowerCase());
}

/**
 * Validates an untrusted sport context (a `?sport=` value or stored string)
 * against the canonical list. Anything else is dropped, never echoed.
 */
export function parseSportContext(raw: unknown): Sport | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const hub = hubBySlug(raw.trim()) ?? hubForSport(raw.trim());
  return hub?.sport ?? null;
}

const CONTEXT_KEY = "openrun:sport-context";

/** Remember which sport a visitor arrived through, so signup can start from it. */
export function rememberSportContext(sport: Sport) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CONTEXT_KEY, sport);
  } catch {
    /* storage can be unavailable */
  }
}

export function readSportContext(): Sport | null {
  if (typeof window === "undefined") return null;
  try {
    return parseSportContext(window.sessionStorage.getItem(CONTEXT_KEY));
  } catch {
    return null;
  }
}

export function clearSportContext() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CONTEXT_KEY);
  } catch {
    /* ignore */
  }
}

/** Move a sport to the front of the profile list; the first entry is the primary sport. */
export function makePrimarySport<T extends { name: string }>(sports: T[], name: string): T[] {
  const i = sports.findIndex((s) => s.name === name);
  if (i <= 0) return sports;
  return [sports[i], ...sports.slice(0, i), ...sports.slice(i + 1)];
}

/**
 * The canonical sports with the viewer's own first (in their order), then the
 * rest in canonical order. Nothing is removed: every sport stays reachable.
 */
export function orderSportsForViewer<T extends { name: string }>(all: T[], mine: string[]): T[] {
  const byName = new Map(all.map((s) => [s.name, s]));
  const first = [...new Set(mine)].flatMap((n) => {
    const s = byName.get(n);
    return s ? [s] : [];
  });
  const firstNames = new Set(first.map((s) => s.name));
  return [...first, ...all.filter((s) => !firstNames.has(s.name))];
}

/**
 * Sports shown first in onboarding, in this order. "Flag Football" is the
 * canonical Football sport (its formats include 5v5 Flag), so it is not a
 * separate entry. Every other canonical sport follows in canonical order.
 */
export const SPORT_PRIORITY = [
  "Basketball",
  "Baseball",
  "Soccer",
  "Pickleball",
  "Volleyball",
  "Softball",
  "Football",
  "Tennis",
] as const;

export function orderSportsByPriority<T extends { name: string }>(all: T[]): T[] {
  return orderSportsForViewer(all, [...SPORT_PRIORITY]);
}
