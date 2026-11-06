/**
 * Pre-submit rules for the email + password form on /auth.
 *
 * The form is `noValidate` on purpose: the inputs' `required` / `minLength`
 * attributes describe the rules to browsers and assistive tech, but the
 * messages have to be inline and announced, so the browser's own bubbles are
 * suppressed. That leaves this function as the only thing standing between an
 * empty or malformed submit and a real auth request with blank credentials.
 * It is pure so the rules can be unit-tested without a DOM.
 */

/** Same shape check as the other forms in this app (see OrgForm). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Supabase refuses shorter passwords anyway; the inputs' `minLength` matches. */
export const MIN_PASSWORD_LENGTH = 6;

export type CredentialField = "email" | "password";

export type CredentialCheck = { ok: true } | { ok: false; field: CredentialField; message: string };

/**
 * Checks fields in reading order and reports the first problem, so focus can
 * land on the field the user has to fix. The email is trimmed (as the submit
 * path trims it); the password is not, because every character counts there.
 */
export function validateCredentials({
  email,
  password,
}: {
  email: string;
  password: string;
}): CredentialCheck {
  const cleanEmail = email.trim();
  if (!cleanEmail) return { ok: false, field: "email", message: "Enter your email." };
  if (!EMAIL_SHAPE.test(cleanEmail)) {
    return { ok: false, field: "email", message: "Enter a valid email address." };
  }
  if (!password) return { ok: false, field: "password", message: "Enter your password." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      field: "password",
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  return { ok: true };
}
