/**
 * What an owner can hide from the public, and the words the page uses for it.
 * Pure data so the server function, the toggle and the tests agree.
 */

export const LISTING_KINDS = ["game", "post", "team", "trainer", "gym"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

/** The table each kind lives in (a trainer profile is a `teams` row of kind 'coach'). */
export const LISTING_TABLE: Record<
  ListingKind,
  "hosted_games" | "team_posts" | "teams" | "trainer_orgs"
> = {
  game: "hosted_games",
  post: "team_posts",
  team: "teams",
  trainer: "teams",
  gym: "trainer_orgs",
};

export type ListingVisibility = {
  /** Hidden by the owner (or a manager acting for them): they can show it again. */
  ownerHidden: boolean;
  /** Hidden by BallaCity moderators: only they can lift it. */
  moderatorHidden: boolean;
};

export const LISTING_COPY: Record<
  ListingKind,
  { noun: string; whoStillSees: string; extra?: string }
> = {
  game: {
    noun: "game",
    whoStillSees: "You and players who joined or asked to join",
    extra: "Hiding does not cancel the game or any bookings.",
  },
  post: { noun: "post", whoStillSees: "You and your team's managers" },
  team: { noun: "team", whoStillSees: "Your team's members and managers" },
  trainer: {
    noun: "trainer profile",
    whoStillSees: "Only you",
    extra: "Hiding does not cancel any bookings.",
  },
  gym: {
    noun: "gym listing",
    whoStillSees: "You, your admins and members",
    extra: "Hiding does not cancel any bookings.",
  },
};

/** Reads the two hide columns of a row, whatever the row's other columns are. */
export function visibilityOf(row: {
  owner_hidden_at?: string | null;
  moderator_hidden_at?: string | null;
}): ListingVisibility {
  return {
    ownerHidden: !!row.owner_hidden_at,
    moderatorHidden: !!row.moderator_hidden_at,
  };
}

/** What a page should offer, given the state. */
export function visibilityAction(v: ListingVisibility): "hide" | "show" | "held" {
  if (v.moderatorHidden) return "held";
  return v.ownerHidden ? "show" : "hide";
}

/** The server function's database errors, in a sentence a person can act on. */
export function hideErrorMessage(message: string): string {
  if (/LISTING_NOT_FOUND|42501|permission/i.test(message)) {
    return "You can't change the visibility of this one.";
  }
  if (/NOT_AUTHENTICATED/i.test(message)) return "Sign in to do that.";
  return "Couldn't update visibility. Try again.";
}
