import { supabase } from "@/integrations/supabase/client";
import { cohortFromBirthday, type AgeCohort } from "@/lib/child-policy";

/**
 * The athlete, as an entity that does not have to be a login.
 *
 * `profiles.id` is a primary key referencing auth.users, so today a player IS
 * an account — which is why adding a child currently means creating that child
 * an email and a password. `player_profiles` separates the two: `account_id`
 * is the adult who manages the athlete, and `user_id` is set only when the
 * athlete also happens to be a login.
 *
 * Stage 1 is additive. Nothing writes to the new table through the app yet and
 * no existing read has been repointed, so every function here falls back to
 * `profiles` when the new table has nothing to say. That fallback is what lets
 * later stages move one surface at a time instead of in a single cutover, and
 * it is why these return the same shape from either source.
 */

export type PlayerProfile = {
  id: string;
  accountId: string;
  /** Null for a managed child, who has no login of their own. */
  userId: string | null;
  displayName: string;
  slug: string | null;
  dateOfBirth: string | null;
  ageCohort: AgeCohort;
  avatarInitials: string | null;
  avatarUrl: string | null;
  bio: string | null;
  primarySport: string | null;
  location: string | null;
  /** True when this row came from the legacy `profiles` table. */
  legacy: boolean;
};

/** A player the account owns but who cannot sign in — the new case. */
export function isManagedPlayer(p: PlayerProfile): boolean {
  return p.userId === null;
}

/**
 * Minor status follows the birthday, never a stored flag, matching the
 * database trigger. A profile with no birthday is "unknown", which the safety
 * rules already treat as its own case rather than as an adult.
 */
export function cohortForPlayer(p: Pick<PlayerProfile, "dateOfBirth">): AgeCohort {
  return p.dateOfBirth ? cohortFromBirthday(p.dateOfBirth) : "unknown";
}

export function isMinorPlayer(p: Pick<PlayerProfile, "dateOfBirth">): boolean {
  const c = cohortForPlayer(p);
  return c === "child_under_13" || c === "teen_13_15" || c === "teen_16_17";
}

type Row = {
  id: string;
  account_id: string;
  user_id: string | null;
  display_name: string;
  slug: string | null;
  date_of_birth: string | null;
  age_cohort: string;
  avatar_initials: string | null;
  avatar_url: string | null;
  bio: string | null;
  primary_sport: string | null;
  location: string | null;
};

function fromRow(r: Row): PlayerProfile {
  return {
    id: r.id,
    accountId: r.account_id,
    userId: r.user_id,
    displayName: r.display_name,
    slug: r.slug,
    dateOfBirth: r.date_of_birth,
    // Trust the birthday over the stored column: the trigger derives one from
    // the other, and if they ever disagree the birthday is the fact.
    ageCohort: r.date_of_birth ? cohortFromBirthday(r.date_of_birth) : "unknown",
    avatarInitials: r.avatar_initials,
    avatarUrl: r.avatar_url,
    bio: r.bio,
    primarySport: r.primary_sport,
    location: r.location,
    legacy: false,
  };
}

const COLUMNS =
  "id, account_id, user_id, display_name, slug, date_of_birth, age_cohort, avatar_initials, avatar_url, bio, primary_sport, location";

/**
 * Every athlete this account manages, including their own.
 *
 * Falls back to the signed-in user's own `profiles` row when the new table has
 * none, so a deployment where the migration has not been applied still shows
 * the user themselves rather than an empty roster.
 */
export async function listMyPlayers(): Promise<PlayerProfile[]> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) return [];

  const { data, error } = await supabase
    .from("player_profiles")
    .select(COLUMNS)
    .eq("account_id", me)
    .order("created_at", { ascending: true });

  // A missing table or a denied read is not a reason to show nothing; fall
  // through to the legacy shape rather than surfacing a Supabase error to a
  // caller that only wanted a roster.
  if (!error && data && data.length > 0) return (data as Row[]).map(fromRow);

  return legacyPlayerFor(me);
}

/** The signed-in user rendered as a player, from the pre-refactor tables. */
async function legacyPlayerFor(userId: string): Promise<PlayerProfile[]> {
  const [{ data: profile }, { data: birthday }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, username, avatar_initials, avatar_url, bio, sport")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("profile_birthdays").select("birthday").eq("user_id", userId).maybeSingle(),
  ]);
  if (!profile) return [];

  const dob = (birthday as { birthday: string | null } | null)?.birthday ?? null;
  const p = profile as {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_initials: string | null;
    avatar_url: string | null;
    bio: string | null;
    sport: string | null;
  };
  return [
    {
      // The legacy identity is the auth id: before the refactor they are the
      // same thing, which is the whole problem this table exists to undo.
      id: p.id,
      accountId: p.id,
      userId: p.id,
      displayName: p.display_name || "Player",
      slug: p.username,
      dateOfBirth: dob,
      ageCohort: dob ? cohortFromBirthday(dob) : "unknown",
      avatarInitials: p.avatar_initials,
      avatarUrl: p.avatar_url,
      bio: p.bio,
      primarySport: p.sport,
      location: null,
      legacy: true,
    },
  ];
}

/** What the Add Player form collects. Everything else is filled in later. */
export type NewPlayerInput = {
  firstName: string;
  lastName: string;
  /** ISO yyyy-mm-dd. */
  dateOfBirth: string;
  sport: string;
  /**
   * True when the account owner is adding themselves. Sets user_id so the
   * profile is linked to their login; a child is left unlinked, which is the
   * entire point — they never need one.
   */
  isSelf: boolean;
};

export class PlayerProfileError extends Error {}

/**
 * Turn a database failure into something a parent can act on.
 *
 * §23: never show a raw Postgres or PostgREST error. The codes here are the
 * ones this table can actually produce — the ownership and cohort rules are
 * enforced as grants and constraints, so a bug in a caller surfaces as 42501
 * or 23514 rather than as a silent success.
 */
function describe(error: { code?: string; message?: string } | null): string {
  switch (error?.code) {
    case "23505":
      return "That profile link is already taken. Try a different name.";
    case "23514":
    case "42501":
      return "You can only add players to your own account.";
    case "23503":
      return "Your account isn't ready yet. Reload the page and try again.";
    default:
      return "Couldn't create that player. Please try again.";
  }
}

/**
 * Create a player under the signed-in account.
 *
 * age_cohort is deliberately absent: it is derived from date_of_birth by a
 * database trigger and is not in the INSERT grant, so naming it here would
 * make the statement fail outright.
 */
export async function createPlayer(input: NewPlayerInput): Promise<PlayerProfile> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new PlayerProfileError("Sign in to add a player.");

  const first = input.firstName.trim();
  const last = input.lastName.trim();
  if (!first) throw new PlayerProfileError("Enter the player's first name.");
  if (!input.dateOfBirth) throw new PlayerProfileError("Enter the player's date of birth.");

  const display = [first, last].filter(Boolean).join(" ");
  const { data, error } = await supabase
    .from("player_profiles")
    .insert({
      account_id: me,
      user_id: input.isSelf ? me : null,
      first_name: first,
      last_name: last || null,
      display_name: display,
      date_of_birth: input.dateOfBirth,
      primary_sport: input.sport || null,
      avatar_initials: initialsFor(first, last),
    })
    .select(COLUMNS)
    .single();

  if (error || !data) throw new PlayerProfileError(describe(error));
  return fromRow(data as Row);
}

/** "Jake Smith" -> "JS"; a first name alone -> "JA". */
export function initialsFor(first: string, last: string): string {
  const f = first.trim();
  const l = last.trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  return f.slice(0, 2).toUpperCase() || "PL";
}

/**
 * Which sections of a player's profile are still empty (§5).
 *
 * Deliberately advisory: nothing here blocks entry to the app, it only tells
 * the owner what is left. Weighted evenly so no single field dominates the
 * percentage.
 */
export const COMPLETION_AREAS = [
  "Profile photo",
  "Sport",
  "Date of birth",
  "Bio",
  "Location",
] as const;

export function completionFor(p: PlayerProfile): { pct: number; missing: string[] } {
  const done: Record<(typeof COMPLETION_AREAS)[number], boolean> = {
    "Profile photo": !!p.avatarUrl,
    Sport: !!p.primarySport,
    "Date of birth": !!p.dateOfBirth,
    Bio: !!p.bio,
    Location: !!p.location,
  };
  const missing = COMPLETION_AREAS.filter((a) => !done[a]);
  const pct = Math.round(
    ((COMPLETION_AREAS.length - missing.length) / COMPLETION_AREAS.length) * 100,
  );
  return { pct, missing: [...missing] };
}
