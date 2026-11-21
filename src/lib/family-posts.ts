/**
 * Family posts: a parent uploads a clip of their under-13 child to the PARENT's
 * account, tagged to the child. Step one is private: only the parent who owns the
 * reel can see it, never the feed, a profile, or other members. The database
 * enforces every rule (see 20261008150000_family_posts.sql); this module only
 * turns its error codes into words a person can act on.
 */

import { knownErrorMessage } from "@/lib/user-error";

/** A friendly message when `err` carries a code we have words for, otherwise null. */
export function familyPostErrorMessage(err: unknown): string | null {
  return knownErrorMessage(err) ?? null;
}
