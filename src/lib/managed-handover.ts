import { errorCode, isUserErrorCode, knownErrorMessage } from "@/lib/user-error";

/**
 * Handing a managed account over to the adult it belongs to (20261128100000, docs/managed-account-handover.md).
 *
 * The managing guardian starts it from the Parent Center for an account whose person is 18 or over and enters that
 * adult's own email address; the adult completes it from the emailed link. This module is the part the Parent Center, the
 * link page and the server functions share: the rules the app states in words, the error sentences, and how a missing
 * migration reads. The rules themselves are the database's.
 */

/** How long an emailed link works. The database decides (start_managed_handover); this is only for the words. */
export const HANDOVER_DAYS = 7;

/** The longest email address the database accepts. */
export const HANDOVER_EMAIL_MAX = 254;

/** What the Parent Center needs to know about one managed account (guardian_managed_handovers). */
export type ManagedHandoverInfo = {
  childUserId: string;
  displayName: string;
  /** The person is a known adult: a handover can start. A minor or an unknown age never can. */
  isAdult: boolean;
  /** A handover is waiting for the adult to finish it. */
  pending: boolean;
  /** The address it was sent to, with all but the first letter hidden. */
  emailMasked: string | null;
  startedAt: string | null;
  expiresAt: string | null;
};

/** A row of guardian_managed_handovers() as PostgREST returns it. */
export type ManagedHandoverRow = {
  child_user_id?: unknown;
  display_name?: unknown;
  is_adult?: unknown;
  pending?: unknown;
  email_masked?: unknown;
  started_at?: unknown;
  expires_at?: unknown;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Reads the database's rows defensively: a row without an id is dropped, an unclear flag reads as "no". */
export function parseManagedHandovers(rows: unknown): ManagedHandoverInfo[] {
  if (!Array.isArray(rows)) return [];
  const out: ManagedHandoverInfo[] = [];
  for (const raw of rows as ManagedHandoverRow[]) {
    const id = str(raw?.child_user_id);
    if (!id) continue;
    out.push({
      childUserId: id,
      displayName: str(raw.display_name) ?? "Child account",
      isAdult: raw.is_adult === true,
      pending: raw.pending === true,
      emailMasked: str(raw.email_masked),
      startedAt: str(raw.started_at),
      expiresAt: str(raw.expires_at),
    });
  }
  return out;
}

/**
 * The database has no such function (the app is ahead of the migration, or the migration was rolled back): PostgREST's
 * schema-cache miss, or Postgres's undefined_function. The handover entry point is then hidden, never an error.
 */
export function isMissingFunctionError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/** Whether an address looks like one before it is sent anywhere. The database checks again. */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= HANDOVER_EMAIL_MAX && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/**
 * The words for a failed handover call. A code the database or the server function raised reads as its catalog sentence;
 * anything else reads as `fallback`, never as raw text.
 */
export function handoverErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  return knownErrorMessage(error) ?? fallback;
}

/** The catalog code an error carries, when it is one we have words for. */
export function handoverErrorCode(error: unknown): string | null {
  const code = errorCode(error);
  return isUserErrorCode(code) ? code : null;
}

/** First name for the buttons ("Hand over Jake's account"). */
export function firstNameOf(displayName: string): string {
  return displayName.split(/\s+/)[0] || displayName;
}

/** The link a person opens from the email. The token is the only secret in it. */
export function handoverPath(token: string): string {
  return `/handover/${token}`;
}
