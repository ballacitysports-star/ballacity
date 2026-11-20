/**
 * Pure rules for the "Host a game" form (WP 4.2): which fields have a problem, in
 * the order the form shows them, so the page can mark every problem next to its
 * field at once and focus the first one. The server stays the source of truth for
 * hosting, age, guardian and approval rules; these checks only stop a publish the
 * host would have to fix anyway.
 */
import {
  formatWhenRange,
  normalizeSchedule,
  validateSchedule,
  validateWhenRange,
  type ScheduleEntry,
  type WhenRange,
} from "./game-schedule";
import { repeatLabel, untilError, type RepeatChoice } from "./game-series-api";
import {
  MAX_GAME_PLAYERS,
  MIN_GAME_PLAYERS,
  validateGamePolicy,
  type GamePolicy,
} from "./game-policy";
import { ageRequirementLabel } from "./game-age";
import type { SportScale } from "./sport-levels";

/** Every field the form can mark, in the order it appears on the page. */
export const CREATE_FIELD_ORDER = [
  "hostAs",
  "when",
  "repeatUntil",
  "venue",
  "spots",
  "fee",
  "minPlayers",
  "cancellationNotes",
  "form",
] as const;
export type CreateField = (typeof CREATE_FIELD_ORDER)[number];
export type CreateFieldErrors = Partial<Record<CreateField, string>>;

/** Fields that live under "More options", which must open before one of them can be shown or focused. */
export const MORE_OPTIONS_FIELDS: ReadonlySet<CreateField> = new Set<CreateField>([
  "fee",
  "minPlayers",
  "cancellationNotes",
]);

export type CreateFormInput = {
  hasAffiliation: boolean;
  multiDay: boolean;
  when: WhenRange;
  schedule: ScheduleEntry[];
  repeat: RepeatChoice;
  location: string;
  profileCity?: string | null;
  spotsText: string;
  paid: boolean;
  feeText: string;
  policy: GamePolicy;
  now?: Date;
  timeZone?: string | null;
};

const PLACEHOLDER_VENUE =
  /^(tbd|tba|tbc|to be (determined|decided|announced|confirmed)|n\/?a|none|unknown|somewhere|\?+|-+)$/i;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Why the venue can't be published, or null. A venue is required: a blank box,
 * "TBD"-style placeholders and the host's own profile city (a city is not a
 * place to meet) are refused.
 */
export function venueError(location: string, profileCity?: string | null): string | null {
  const v = location.trim();
  if (!v) return "Add where the game is: a court, park or venue.";
  if (PLACEHOLDER_VENUE.test(v.replace(/[.!]+$/g, "").trim())) {
    return "Add the real venue. Players need to know where to go.";
  }
  if (norm(v).length < 3) return "Add the venue's name or address.";
  const city = profileCity?.trim();
  if (city) {
    const n = norm(v);
    if (n === norm(city) || n === norm(city.split(",")[0] ?? "")) {
      return "That's a city. Add the court, park or venue.";
    }
  }
  return null;
}

/** The spots box as typed, or null when it isn't a whole number between the limits. */
export function parseSpots(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= MIN_GAME_PLAYERS && n <= MAX_GAME_PLAYERS ? n : null;
}

export const SPOTS_ERROR = `Choose between ${MIN_GAME_PLAYERS} and ${MAX_GAME_PLAYERS} spots.`;
export const FEE_ERROR = "Enter an entry fee of at least $1, or turn off Paid game.";

/** Every problem on the form at once, keyed by field. Empty when the game can be published. */
export function validateCreateForm(input: CreateFormInput): CreateFieldErrors {
  const now = input.now ?? new Date();
  const tz = input.timeZone ?? null;
  const errors: CreateFieldErrors = {};

  if (!input.hasAffiliation) errors.hostAs = "Pick who you're hosting as.";

  if (input.multiDay) {
    const check = validateSchedule(input.schedule, now, tz);
    if (!check.ok) errors.when = check.error ?? "Fix the schedule to continue.";
  } else {
    const check = validateWhenRange(input.when, now, tz);
    if (!check.ok) errors.when = check.error ?? "Fix the date and time to continue.";
    // Repeat applies to one-day games only.
    if (input.repeat.freq !== "none") {
      const problem = untilError(input.when.startDate, input.repeat.until);
      if (problem) errors.repeatUntil = problem;
    }
  }

  const venue = venueError(input.location, input.profileCity);
  if (venue) errors.venue = venue;

  const spots = parseSpots(input.spotsText);
  if (spots == null) errors.spots = SPOTS_ERROR;

  if (input.paid) {
    const fee = Number(input.feeText);
    if (!input.feeText.trim() || !Number.isFinite(fee) || fee < 1) errors.fee = FEE_ERROR;
  }

  const maxPlayers = spots ?? input.policy.maxPlayers;
  if (input.policy.minPlayers < 0) {
    errors.minPlayers = "Minimum players can't be negative.";
  } else if (input.policy.minPlayers > maxPlayers) {
    errors.minPlayers = "Minimum to play can't be more than the spots.";
  }
  if (input.policy.cancellationPolicy === "custom" && !input.policy.cancellationNotes.trim()) {
    errors.cancellationNotes = "Describe your custom cancellation terms.";
  }

  // Backstop: the shared policy check (which the database mirrors) must agree.
  if (!errors.spots && !errors.minPlayers && !errors.cancellationNotes) {
    const policyCheck = validateGamePolicy({ ...input.policy, maxPlayers });
    if (!policyCheck.ok) errors.form = policyCheck.error;
  }

  return errors;
}

/** The first field with a problem, in page order. */
export function firstErrorField(errors: CreateFieldErrors): CreateField | null {
  return CREATE_FIELD_ORDER.find((f) => !!errors[f]) ?? null;
}

export function errorCount(errors: CreateFieldErrors): number {
  return CREATE_FIELD_ORDER.filter((f) => !!errors[f]).length;
}

export type MoreOptionsState = {
  paid: boolean;
  price: number;
  priv: boolean;
  requiresApproval: boolean;
  minAge: number | null;
  maxAge: number | null;
  signupCutoffMin: number;
};

/**
 * One line per setting that decides who can join and what it costs, shown while
 * "More options" is closed so a restored draft or a copied game can't publish a
 * private, paid, age-limited or open-to-all game the host never saw.
 */
export function moreOptionsSummary(s: MoreOptionsState): string[] {
  const out = [
    s.requiresApproval ? "You approve each player" : "Anyone can join without approval",
    s.priv ? "Private (invite only)" : "Public",
    s.paid ? `$${s.price > 0 ? formatFee(s.price) : "?"} entry fee` : "Free",
  ];
  const ages = ageRequirementLabel({ minAge: s.minAge, maxAge: s.maxAge });
  if (ages) out.push(ages.startsWith("Age ") ? ages : `Ages ${ages.replace(/^Up to/, "up to")}`);
  if (s.signupCutoffMin > 0) out.push("Signup cutoff set");
  return out;
}

/** True when anything under "More options" differs from the defaults a new game starts with. */
export function moreOptionsChanged(s: MoreOptionsState): boolean {
  return (
    s.paid ||
    s.priv ||
    !s.requiresApproval ||
    s.minAge != null ||
    s.maxAge != null ||
    s.signupCutoffMin !== 0
  );
}

const formatFee = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * The hint under the skill chips. Only a sport whose levels come in formats
 * (Football: Flag / 7v7 / Full contact) gets the "one per format" example, and
 * the example is built from that sport's own tier names.
 */
export function skillHint(scale: SportScale): string | null {
  if (!scale.multi) return null;
  const groups = scale.groups ?? [];
  const formatGroups =
    groups.length >= 2 &&
    groups.every((g) => g.tiers.length > 0 && g.tiers.every((t) => t.startsWith(`${g.label} `)));
  if (formatGroups) {
    const a = groups[0].tiers[Math.min(1, groups[0].tiers.length - 1)];
    const b = groups[1].tiers[groups[1].tiers.length - 1];
    return `Pick a level in each format you welcome — selections combine (e.g. "${a} · ${b}").`;
  }
  return "Pick every level you welcome — you can choose more than one.";
}

/** The title a game gets when the host leaves the box blank. */
export function defaultGameTitle(sport: string): string {
  return `${sport} game`;
}

export type PublishSummaryInput = {
  title: string;
  sport: string;
  multiDay: boolean;
  when: WhenRange;
  schedule: ScheduleEntry[];
  repeat: RepeatChoice;
  location: string;
  spots: number;
  requiresApproval: boolean;
  priv: boolean;
  paid: boolean;
  price: number;
};

/** The lines the Publish step shows, so the host sees what goes live before confirming. */
export function publishSummaryLines(i: PublishSummaryInput): { label: string; value: string }[] {
  let when: string;
  if (i.multiDay) {
    const days = normalizeSchedule(i.schedule).length;
    when = `${days} ${days === 1 ? "day" : "days"}`;
  } else {
    const repeats =
      i.repeat.freq === "none" ? null : repeatLabel({ freq: i.repeat.freq, until: i.repeat.until });
    when = `${formatWhenRange(i.when)}${repeats ? ` · ${repeats.toLowerCase()}` : ""}`;
  }
  return [
    { label: "Game", value: i.title.trim() || defaultGameTitle(i.sport) },
    { label: "Sport", value: i.sport },
    { label: "When", value: when },
    { label: "Where", value: i.location.trim() },
    { label: "Spots", value: String(i.spots) },
    {
      label: "Joining",
      value: `${i.requiresApproval ? "You approve each player" : "Anyone can join"}${
        i.priv ? " · private (invite only)" : ""
      }`,
    },
    { label: "Cost", value: i.paid ? `$${formatFee(i.price)} per player` : "Free" },
  ];
}
