import { sanitizeNextPath } from "@/lib/safe-next-path";

/**
 * WP 4.1: "Complete my profile" brings the member back to what they were doing once the profile is saved.
 * /profile/edit takes the way back as `returnTo`, and only a path on this site gets through (sanitizeNextPath, the
 * same filter as the sign-in `next`), so it can never send anyone off the site.
 */
export type ProfileEditSearch = { returnTo?: string };

export function validateProfileEditSearch(search: Record<string, unknown>): ProfileEditSearch {
  const returnTo = sanitizeNextPath(search.returnTo);
  return returnTo ? { returnTo } : {};
}

/**
 * Where "Complete my profile" returns to from the posting check: My availability & invitations, ready to post. The
 * screen opens the quick sheet once, and only if the posting check now passes.
 */
export const AVAILABILITY_POST_RETURN = "/availability?compose=quick";
