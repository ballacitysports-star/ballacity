import type { Game } from "@/lib/sample-data";
import { computeLiveStatus } from "@/lib/live-status";
import { collapseSeriesGames } from "@/lib/game-series";

/**
 * Events tied to a facility are plain `hosted_games` rows with `org_id` set.
 * There is no stored event-type column, so the kind is derived from the title
 * and description, and "Post event" seeds a title the classifier recognizes.
 */
export type FacilityEventKind = "run" | "open_court" | "clinic" | "tournament";

export const FACILITY_EVENT_KINDS: ReadonlyArray<{
  kind: FacilityEventKind;
  label: string;
  /** Plural, for filter chips. */
  plural: string;
  /** Title the post-event form starts with, given the facility name. */
  defaultTitle: (orgName: string) => string;
}> = [
  {
    kind: "run",
    label: "Pickup run",
    plural: "Pickup runs",
    defaultTitle: (n) => `${n} pickup run`,
  },
  {
    kind: "open_court",
    label: "Open court",
    plural: "Open court",
    defaultTitle: (n) => `${n} open court session`,
  },
  { kind: "clinic", label: "Clinic", plural: "Clinics", defaultTitle: (n) => `${n} clinic` },
  {
    kind: "tournament",
    label: "Tournament",
    plural: "Tournaments",
    defaultTitle: (n) => `${n} tournament`,
  },
];

const TOURNAMENT_RE = /\b(tournament|tourney|invitational|shootout|playoffs?|bracket)\b/i;
const CLINIC_RE = /\b(clinic|camp|workshop|lesson|academy|training|drills?|combine)\b/i;
const OPEN_COURT_RE =
  /\b(open\s+(court|gym|play|session|shoot(?:around)?)|court\s+(rental|time)|drop[\s-]?in|shoot\s?around)\b/i;

const KIND_RULES = [
  [TOURNAMENT_RE, "tournament"],
  [CLINIC_RE, "clinic"],
  [OPEN_COURT_RE, "open_court"],
] as const;

/**
 * Best-effort kind of a facility event, from its title only (descriptions
 * mention things like "all skill levels" that would misclassify a run).
 * Defaults to a pickup run.
 */
export function classifyFacilityEvent(game: Pick<Game, "title">): FacilityEventKind {
  const title = game.title ?? "";
  for (const [re, kind] of KIND_RULES) if (re.test(title)) return kind;
  return "run";
}

export function facilityEventKindLabel(kind: FacilityEventKind): string {
  return FACILITY_EVENT_KINDS.find((k) => k.kind === kind)?.label ?? "Event";
}

export function isFacilityEventKind(v: unknown): v is FacilityEventKind {
  return FACILITY_EVENT_KINDS.some((k) => k.kind === v);
}

/** Events that are still ahead of (or running at) `now`, soonest first. */
export function upcomingFacilityEvents(games: readonly Game[], now: number = Date.now()): Game[] {
  const live = games
    .filter((g) => !g.cancelledAt && g.status !== "cancelled" && !g.isPrivate)
    .filter((g) => computeLiveStatus(g, now) !== "completed")
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  // A multi-day event is one listing, shown at its next session.
  return collapseSeriesGames(live, "upcoming", now);
}

/** Link target for the facility page's "Post event / open run" action. */
export function postFacilityEventSearch(
  orgId: string,
  kind: FacilityEventKind = "run",
): { orgId: string; kind: FacilityEventKind } {
  return { orgId, kind };
}

export function defaultFacilityEventTitle(kind: FacilityEventKind, orgName: string): string {
  const name = orgName.trim() || "Open";
  return (
    FACILITY_EVENT_KINDS.find((k) => k.kind === kind) ?? FACILITY_EVENT_KINDS[0]
  ).defaultTitle(name);
}
