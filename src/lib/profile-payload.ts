import type { SportEntry } from "@/components/profile/ProfileSportsFields";

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
  const skillLevels = Object.fromEntries(
    input.sports.map((s) => [s.name, String(s.skill)]),
  );
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
    skill_levels: skillLevels,
    ...(input.links ? { links: input.links } : {}),
  };
}
