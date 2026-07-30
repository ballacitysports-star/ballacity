import type { SportEntry } from "@/components/profile/ProfileSportsFields";
import { serializeSportLevels } from "@/lib/sport-levels";


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
  sports: SportEntry[];
  links?: ProfileLink[];
};

/**
 * Canonical `profiles` row written by BOTH onboarding and Edit profile so the
 * two flows can never save a different schema.
 */
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
    sport: primary ?? null,
    sport_levels: serializeSportLevels(input.sports),

    ...(input.links ? { links: input.links } : {}),
  };
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
