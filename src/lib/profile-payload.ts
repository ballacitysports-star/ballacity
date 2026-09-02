import { checkChildUsername, cohortFromBirthday } from "@/lib/child-policy";
import type { SportEntry } from "@/components/profile/ProfileSportsFields";
import { serializeSportLevels } from "@/lib/sport-levels";
import { clampDistanceMi } from "@/lib/distance";


export type ProfileLink = { url: string; label?: string; [k: string]: unknown };

export type ProfilePayloadInput = {
  userId: string;
  name: string;
  username: string;
  avatarInitials: string;
  bio: string;
  city: string;
  avatarUrl?: string;
  coverUrl?: string;
  birthday?: string;
  graduatingClass?: number;
  /** Location preference: saved search radius in miles. */
  searchRadiusMi?: number | null;
  sports: SportEntry[];
  links?: ProfileLink[];
};

/**
 * Canonical `profiles` row written by BOTH onboarding and Edit profile so the
 * two flows can never save a different schema.
 */
/**
 * Minor-safety validation shared by onboarding and Edit profile. Returns an
 * error message when the username carries identifying information for a minor,
 * mirroring the `minor_handle_unsafe` database trigger so the user sees the
 * problem before the write is refused.
 */
export function validateProfileSafety(input: {
  username: string;
  name?: string | null;
  birthday?: string | null;
}): string | null {
  const check = checkChildUsername(input.username ?? "", {
    cohort: cohortFromBirthday(input.birthday ?? null),
    fullName: input.name ?? null,
  });
  return check.ok ? null : (check.message ?? "Pick a different username");
}

export function buildProfileRow(input: ProfilePayloadInput) {
  const primary = input.sports[0]?.name;
  return {
    id: input.userId,
    display_name: input.name,
    username: input.username.trim().replace(/^@/, "").slice(0, 30) || null,
    avatar_initials: input.avatarInitials,
    bio: input.bio.trim().slice(0, 280) || null,
    city: input.city.trim().slice(0, 80) || null,
    avatar_url: input.avatarUrl ?? null,
    cover_url: input.coverUrl ?? null,
    birthday: input.birthday ?? null,
    graduating_class: input.graduatingClass ?? null,
    search_radius_mi: clampDistanceMi(input.searchRadiusMi ?? null),
    sport: primary ?? null,
    sport_levels: serializeSportLevels(input.sports),

    ...(input.links ? { links: input.links } : {}),
  };
}

/**
 * Persists a canonical profile row.
 *
 * Birthdays are never stored on `profiles` — that column no longer exists, so
 * no profile read can leak an exact birthdate. Direct writes to the private
 * `profile_birthdays` table are revoked as well: the date of birth goes
 * through the `set_my_birthday` routine, which validates it, derives the age
 * cohort server-side, and flags an age change for review when needed.
 */
export async function saveProfileRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  row: Record<string, unknown>,
): Promise<void> {
  const { birthday, ...rest } = row as { birthday?: unknown };
  const { error } = await client.from("profiles").upsert(rest, { onConflict: "id" });
  if (error) throw error;

  if (typeof birthday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    const { error: bErr } = await client.rpc("set_my_birthday", { _dob: birthday });
    // A locked birthday is expected on every later save: the UI shows it
    // read-only and corrections go through support review instead.
    if (bErr && !String(bErr.message ?? "").includes("BIRTHDAY_LOCKED")) throw bErr;
  }
}



/**
 * Stable fingerprint of a profile row, used as an idempotency key so repeated
 * onboarding submissions with unchanged data are skipped instead of re-written.
 */
export function profileRowFingerprint(row: Record<string, unknown>): string {
  const stable = Object.keys(row)
    .sort()
    .map((k) => [k, row[k]] as const);
  return JSON.stringify(stable);
}


export const onboardingSaveKey = (userId: string) => `openrun.onboarding_saved.${userId}`;
