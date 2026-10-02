import type { User } from "@supabase/supabase-js";

/**
 * Managed children: minors whose account a guardian created and who have no
 * email or password of their own.
 *
 * A managed child is an ordinary auth user, so every child-safety control that
 * keys on the child's auth id (consent locks, messaging, hosting, comments,
 * rosters, AI, location floor, birthday immutability) applies unchanged. The
 * only differences are that the account has no usable credentials and that a
 * linked guardian can switch into it (`startManagedSession`).
 *
 * This module is pure so the server functions, the UI and the tests share one
 * definition of names, limits and messages.
 */

/**
 * `.invalid` is reserved (RFC 2606): nothing on it can ever receive mail. The
 * local part is random so the address reveals nothing about the child.
 */
export const MANAGED_EMAIL_DOMAIN = "managed.invalid";

export function managedEmailFor(random: string): string {
  const local = random.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (local.length < 16) throw new Error("managedEmailFor needs at least 16 random characters.");
  return `m${local}@${MANAGED_EMAIL_DOMAIN}`;
}

export function isManagedEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${MANAGED_EMAIL_DOMAIN}`);
}

/**
 * The part of an address before "@", for the places that fall back to it as a
 * name — or null. Never a managed child's placeholder, which is random
 * characters, not a name.
 */
export function emailLocalPart(email: string | null | undefined): string | null {
  if (!email || isManagedEmail(email)) return null;
  return email.split("@")[0] || null;
}

/** An address fit to show a person; a managed child has none to show. */
export function displayEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return isManagedEmail(email) ? "Managed child · no email" : email;
}

/**
 * True when an auth-email hook payload is addressed to a managed child. The
 * hook is how Supabase asks the app to send signup, recovery, magic-link and
 * email-change mail; for a managed child there is nobody to receive it, and an
 * email change started from a child session must not reach a new address
 * either — giving a child their own login is a guardian action.
 */
export function isManagedAuthEmailPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const user = (payload as { user?: { email?: unknown } }).user;
  return typeof user?.email === "string" && isManagedEmail(user.email);
}

/**
 * True for a session belonging to a managed child. `app_metadata` can only be
 * written with the service role, so a signed-in user cannot set this on
 * themselves.
 */
export function isManagedUser(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.managed === true;
}

/** The guardian who created this managed child, from the same tamper-proof field. */
export function managedByOf(user: Pick<User, "app_metadata"> | null | undefined): string | null {
  const v = user?.app_metadata?.managed_by;
  return typeof v === "string" ? v : null;
}

/**
 * A database error that means "this table does not exist (yet)": PostgREST's
 * schema-cache miss, or Postgres's undefined_table. The managed-children
 * migration is applied separately from publishing the app, so every place that
 * reads `managed_accounts` has to decide what a missing table means — usually
 * "nobody manages a child", never "something unexpected went wrong".
 */
export function isMissingRelationError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export const GUARDIAN_RELATIONSHIPS = ["parent", "guardian", "grandparent", "other adult"] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export function isGuardianRelationship(v: unknown): v is GuardianRelationship {
  return typeof v === "string" && (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(v);
}

/** Letters (any script), spaces, apostrophes, hyphens and periods — nothing that can carry contact details. */
const NAME_RE = /^\p{L}[\p{L}\p{M}' .-]*$/u;
export const MAX_FIRST_NAME = 40;

export type NameCheck = { ok: true; displayName: string } | { ok: false; message: string };

/**
 * "Jake" + "Smith" → "Jake S.". Only the initial of the last name is ever
 * stored: a child's full name is not needed for anything on the platform.
 */
export function childDisplayName(firstName: string, lastName?: string | null): NameCheck {
  const first = (firstName ?? "").trim().replace(/\s+/g, " ");
  const last = (lastName ?? "").trim();
  if (!first) return { ok: false, message: "Enter your child's first name." };
  if (first.length > MAX_FIRST_NAME) {
    return { ok: false, message: `Keep the first name under ${MAX_FIRST_NAME} characters.` };
  }
  if (!NAME_RE.test(first)) {
    return { ok: false, message: "Use letters only in the first name." };
  }
  if (last && !NAME_RE.test(last)) {
    return { ok: false, message: "Use letters only in the last name." };
  }
  const initial = last ? `${last[0].toUpperCase()}.` : "";
  return { ok: true, displayName: initial ? `${first} ${initial}` : first };
}

export function initialsForDisplayName(displayName: string): string {
  const parts = displayName.replace(/\./g, "").split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : (parts[0]?.slice(0, 2) ?? "");
  return letters.toUpperCase() || "PL";
}

/**
 * Database and server error codes → something a parent can act on. §23: never
 * show a raw Postgres or PostgREST error.
 */
const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Sign in to add your child.",
  ADULT_REQUIRED:
    "Only an adult account with a confirmed email and verified age can add a child. Finish your own setup first.",
  NOT_YOUR_MANAGED_CHILD: "That profile isn't one you created.",
  ALREADY_PROVISIONED: "That profile is already set up.",
  MANAGED_LIMIT:
    "You've reached the limit for child profiles right now. Contact support if you need more.",
  MINOR_HANDLE_UNSAFE: "Remove personal details (numbers, email, address) from the name.",
  CHILD_IS_ADULT: "That birthday makes them an adult — they can sign up with their own account.",
  DOB_REQUIRED: "Enter your child's birthday.",
  DOB_INVALID: "Enter a real birthday.",
  DOB_IN_FUTURE: "The birthday can't be in the future.",
  NAME_REQUIRED: "Enter your child's first name.",
  NAME_INVALID: "Use letters only in your child's name.",
  LEGAL_VERSION_STALE:
    "Our Terms or Privacy Policy were just updated. Reload the page and try again.",
  LEGAL_VERSION_INVALID:
    "Our Terms or Privacy Policy couldn't be loaded. Reload the page and try again.",
  ATTESTATION_REQUIRED: "Confirm that you're this child's parent or legal guardian.",
  NOT_AUTHORIZED: "You can only manage children linked to your account.",
  NOT_MANAGED: "That child has their own login, so you can't switch into their profile.",
  MANAGED_CHILD_DELETE_INSTEAD:
    "This child only exists under your account. Delete their profile instead of ending the link.",
  MANAGED_SESSION_NOT_ALLOWED: "Switch back to your own account to do that.",
  MANAGES_CHILDREN: "Your account can't be deleted while it manages child profiles.",
  MANAGED_UNAVAILABLE: "Adding a child isn't available yet. Please try again later.",
  MANAGES_CHECK_FAILED:
    "We couldn't check whether your account manages any children, so nothing was deleted. Please try again.",
  // Device pairing (src/lib/device-pairing.functions.ts): a guardian-issued
  // code that lets a managed child's own device hold its own session.
  PAIRING_INVALID: "That pairing code isn't valid. Ask your guardian for a new one.",
  PAIRING_EXPIRED: "That pairing code has expired. Ask your guardian for a new one.",
  PAIRING_USED: "That pairing code was already used. Ask your guardian for a new one.",
  PAIRING_REVOKED: "That pairing code was cancelled. Ask your guardian for a new one.",
  PAIRING_NOT_FOUND: "No device is currently paired.",
  PAIRING_UNAVAILABLE: "Pairing a device isn't available yet. Please try again later.",
};

/** The code a database or server error starts with, when it is one we know. */
export function managedChildErrorCode(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  for (const code of Object.keys(MESSAGES)) {
    if (new RegExp(`\\b${code}\\b`).test(raw)) return code;
  }
  return null;
}

export function managedChildErrorMessage(error: unknown): string {
  const code = managedChildErrorCode(error);
  return code ? MESSAGES[code] : "Something went wrong. Please try again.";
}
