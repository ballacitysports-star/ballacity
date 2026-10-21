/**
 * A team's mark is two separate things: a logo image (`avatar_url`) and short
 * initials (`avatar`). Older rows kept an uploaded logo's URL in `avatar`, so
 * everything here accepts both layouts.
 */
export const isImageUrl = (v: string | null | undefined): v is string =>
  /^(https?:|data:|blob:)/.test(v ?? "");

type Stored = { avatar?: string | null; avatar_url?: string | null };

/** The logo URL, if the team has one (new `avatar_url`, or an older URL in `avatar`). */
export function teamLogoUrl(row: Stored): string | null {
  if (row.avatar_url) return row.avatar_url;
  return isImageUrl(row.avatar) ? row.avatar : null;
}

/** The team's own initials, never a URL; "" when none were set. */
export function teamInitials(row: Stored): string {
  return isImageUrl(row.avatar) ? "" : (row.avatar ?? "");
}

/**
 * The single value cards and lists render: the logo when there is one, else
 * the initials. Lets code that only knows "an image URL or short text" keep
 * working unchanged.
 */
export function teamAvatarDisplay(row: Stored): string {
  return teamLogoUrl(row) ?? teamInitials(row);
}

/**
 * Splits whatever an editor or older caller hands over into the two columns to
 * save. `avatarUrl` wins as the logo; a URL passed as `avatar` is treated as
 * the logo too, so callers that still use the old single field keep working.
 * Fields left `undefined` are left out, so a partial update never clears the
 * other half.
 */
export function splitTeamAvatar(input: { avatar?: string | null; avatarUrl?: string | null }): {
  avatar?: string;
  avatar_url?: string | null;
} {
  const out: { avatar?: string; avatar_url?: string | null } = {};
  if (input.avatar !== undefined) {
    if (isImageUrl(input.avatar)) {
      out.avatar = "";
      if (input.avatarUrl === undefined) out.avatar_url = input.avatar;
    } else {
      out.avatar = input.avatar ?? "";
    }
  }
  if (input.avatarUrl !== undefined) out.avatar_url = input.avatarUrl || null;
  return out;
}
