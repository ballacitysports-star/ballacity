/**
 * Location privacy for games that may include children (youth-inclusive games).
 *
 * The database keeps the exact venue of a youth-inclusive game in `hosted_game_private`, readable only by the
 * host, people on the roster, their verified guardians and the game's managers (PRIV-2A). Everyone else sees a
 * coarse form: the neighborhood label and coordinates rounded to two decimals (about 1 km). These helpers are
 * the client/server twin of that rule so a screen never shows, caches, shares or notifies more than the viewer
 * is entitled to, whether or not the database switch that coarsens the public columns is on yet.
 *
 * Keep `coarseGameLabel` and `coarseCoordinate` identical to `private_sec.coarse_game_label` and
 * `round(x, 2)` in supabase/migrations/20261104100000_youth_game_private_location.sql: the database treats a
 * location equal to them as "already coarse" and never stores it as the exact one.
 *
 * A game with no age limit is youth-inclusive; only an enforced adult-only range (18+) is exempt.
 */
import { gameAgeRangeIsAdultOnly } from "@/lib/city-seo";

export const COARSE_FALLBACK_LABEL = "Location shared after you join";

export type AgeRange = { minAge?: number | null; maxAge?: number | null };

export function isYouthInclusiveGame(g: AgeRange | null | undefined): boolean {
  return !gameAgeRangeIsAdultOnly({ min_age: g?.minAge ?? null, max_age: g?.maxAge ?? null });
}

export function coarseCoordinate(n: number | string | null | undefined): number | null {
  if (n === null || n === undefined || n === "") return null;
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

export function coarseGameLabel(neighborhood: string | null | undefined): string {
  const label = (neighborhood ?? "").trim();
  return label || COARSE_FALLBACK_LABEL;
}

export type LocatedGame = AgeRange & {
  location: string;
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
  locationPrecision?: "exact" | "approximate";
};

type Precision = { locationPrecision?: "exact" | "approximate" };

export type ExactLocation = { location: string | null; lat: number | null; lng: number | null };

/** Coarse form of a game for a viewer who is not authorized. Adult-only games are returned unchanged. */
export function coarsenGame<T extends LocatedGame>(g: T): T & Precision {
  if (!isYouthInclusiveGame(g)) return { ...g, locationPrecision: "exact" };
  return {
    ...g,
    location: coarseGameLabel(g.neighborhood),
    lat: coarseCoordinate(g.lat),
    lng: coarseCoordinate(g.lng),
    locationPrecision: "approximate",
  };
}

/** Overlay the exact location the database released to this viewer. */
export function withExactLocation<T extends LocatedGame>(
  g: T,
  exact: ExactLocation | undefined,
): T & Precision {
  if (!exact || !isYouthInclusiveGame(g)) return g;
  return {
    ...g,
    location: exact.location ?? g.location,
    lat: exact.lat ?? g.lat ?? null,
    lng: exact.lng ?? g.lng ?? null,
    locationPrecision: "exact",
  };
}

/** What may be written to device storage: never an exact youth-game location. */
export function redactForStorage<T extends LocatedGame>(g: T): T & Precision {
  return coarsenGame(g);
}

/** A database row shape used by server code (snake_case). */
export type LocatedRow = {
  min_age?: number | null;
  max_age?: number | null;
  location?: string | null;
  neighborhood?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};

/** Server-side coarsening of a row for an audience that is not entitled to the exact venue. */
export function coarsenRow<T extends LocatedRow>(r: T): T {
  if (!isYouthInclusiveGame({ minAge: r.min_age ?? null, maxAge: r.max_age ?? null })) return r;
  return {
    ...r,
    location: coarseGameLabel(r.neighborhood),
    lat: r.lat === undefined ? r.lat : coarseCoordinate(r.lat),
    lng: r.lng === undefined ? r.lng : coarseCoordinate(r.lng),
  };
}

/** Text safe to put in a notification, push payload or shared link for a youth-inclusive game. */
export function notificationLocationText(r: LocatedRow): string | null {
  if (!isYouthInclusiveGame({ minAge: r.min_age ?? null, maxAge: r.max_age ?? null })) {
    return r.location ? `Where: ${r.location}` : null;
  }
  const area = (r.neighborhood ?? "").trim();
  return area
    ? `Area: ${area} · Open the game for the exact location`
    : "Open the game for the exact location";
}

/** Plain-language explanation for the location block of the game page. */
export type ExactLocationStatus = "idle" | "loading" | "ready" | "error";

export type GameLocationView =
  | { kind: "exact" }
  | { kind: "loading" }
  | { kind: "approximate"; note: string }
  | { kind: "error"; note: string };

export function gameLocationView(
  g: LocatedGame,
  status: ExactLocationStatus,
  signedIn: boolean,
): GameLocationView {
  if (!isYouthInclusiveGame(g) || g.locationPrecision === "exact") return { kind: "exact" };
  if (signedIn && (status === "loading" || status === "idle")) return { kind: "loading" };
  if (signedIn && status === "error") {
    return { kind: "error", note: "We couldn't check your access to the exact location." };
  }
  return {
    kind: "approximate",
    note: signedIn
      ? "The exact location is shared once you're confirmed for this game and any entry fee is paid."
      : "Sign in and join to see the exact location.",
  };
}
