/**
 * Server only. The adult's side of a managed-account handover (20261128100000, docs/managed-account-handover.md).
 *
 * The browser never decides anything here. The adult follows the emailed link; the app (this module, with the service
 * role) does, in this order, and stops at the first thing that fails:
 *
 *   1. claim_managed_handover   one finisher at a time, and the guardian cannot cancel under it.
 *   2. read the sign-in record  it must still be the managed placeholder of the guardian the database names.
 *   3. update the sign-in record  the adult's address, confirmed, and no longer marked managed (Admin API).
 *   4. finish_managed_handover  the database re-checks everything, removes the managed row, revokes sessions and device
 *                               pairings, ends the guardian link, tells both sides once, closes the handover. One
 *                               transaction, or nothing.
 *   5. a one-time sign-in link  so the adult sets their password in the browser (the password never reaches this server).
 *
 * Fail closed: if step 3 or 4 fails, step 3 is put back (placeholder address, marked managed again) and the claim is
 * released, so the account is managed and linked exactly as before. If step 5 fails the handover is already complete and
 * the adult signs in with "Forgot password" on their own address.
 */
import { createHash } from "crypto";
import { errorInsteadOf } from "@/lib/error-report";
import { isManagedEmail, isManagedUser, managedByOf } from "@/lib/managed-children";
import { handoverErrorMessage, isMissingFunctionError } from "@/lib/managed-handover";
import { knownErrorMessage } from "@/lib/user-error";

export function hashHandoverToken(token: string): string {
  return createHash("sha256").update(`openrun-handover:${token}`).digest("hex");
}

/** 32 random bytes as hex: the only secret in the emailed link. Only its hash is ever stored. */
export function newHandoverToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type HandoverLookup =
  | {
      valid: true;
      childName: string;
      guardianName: string | null;
      emailMasked: string | null;
      expiresAt: string | null;
    }
  | { valid: false; code: string };

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

/** The sentence for a code the database or this module raised; `fallbackCode` when it is not one we have words for. */
function say(code: unknown, fallbackCode = "HANDOVER_FAILED"): string {
  return handoverErrorMessage(code, handoverErrorMessage(fallbackCode));
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** What the landing page shows the person holding the link. Never the address, never anything else of the account. */
export async function lookupHandover(token: string): Promise<HandoverLookup> {
  const db = await admin();
  const { data, error } = (await db.rpc(
    "managed_handover_lookup" as never,
    {
      _token_hash: hashHandoverToken(token),
    } as never,
  )) as RpcResult;
  // Not applied yet, or any read failure: the link simply is not valid. The page offers sign-in, never an error.
  if (error) return { valid: false, code: "HANDOVER_INVALID" };
  const r = (data ?? {}) as Record<string, unknown>;
  if (r["valid"] !== true) {
    return {
      valid: false,
      code: typeof r["code"] === "string" ? (r["code"] as string) : "HANDOVER_INVALID",
    };
  }
  return {
    valid: true,
    childName: typeof r["child_name"] === "string" ? (r["child_name"] as string) : "this account",
    guardianName: typeof r["guardian_name"] === "string" ? (r["guardian_name"] as string) : null,
    emailMasked: typeof r["email_masked"] === "string" ? (r["email_masked"] as string) : null,
    expiresAt: typeof r["expires_at"] === "string" ? (r["expires_at"] as string) : null,
  };
}

/** A refusal the person can act on reads as words; a failure we did not expect is reported and reads as `fallbackCode`. */
function failure(error: unknown, fallbackCode: string): Error {
  const known = knownErrorMessage(error);
  if (known) return new Error(known);
  return errorInsteadOf(error, say(fallbackCode));
}

async function report(error: unknown): Promise<void> {
  try {
    const { reportServerFnError } = await import("@/lib/server-fn-report.server");
    await reportServerFnError(error, "/handover");
  } catch {
    /* reporting never changes the answer */
  }
}

type AdminAuth = Awaited<ReturnType<typeof admin>>["auth"]["admin"];

/** Step 3 undone. Best effort: if this too fails the handover stays pending and the adult can retry the same link. */
async function putBack(
  auth: AdminAuth,
  childUserId: string,
  placeholder: string,
  managedBy: string,
) {
  const { error } = await auth.updateUserById(childUserId, {
    email: placeholder,
    email_confirm: true,
    app_metadata: { managed: true, managed_by: managedBy },
  });
  if (error) await report(error);
}

export type CompletedHandover = {
  /** One-time token hash for supabase.auth.verifyOtp({ type: "recovery" }), or null if it could not be made. */
  recoveryTokenHash: string | null;
  childUserId: string;
};

export async function completeHandover(token: string): Promise<CompletedHandover> {
  const db = await admin();
  const tokenHash = hashHandoverToken(token);
  const release = () =>
    Promise.resolve(
      db.rpc("release_managed_handover" as never, { _token_hash: tokenHash } as never),
    ).catch(() => undefined);

  // 1. claim
  const claimed = (await db.rpc(
    "claim_managed_handover" as never,
    { _token_hash: tokenHash } as never,
  )) as RpcResult;
  if (claimed.error) {
    throw failure(
      claimed.error,
      isMissingFunctionError(claimed.error) ? "HANDOVER_UNAVAILABLE" : "HANDOVER_FAILED",
    );
  }
  const c = (claimed.data ?? {}) as Record<string, unknown>;
  if (c["ok"] !== true) throw new Error(say(c["code"], "HANDOVER_INVALID"));
  const childUserId = String(c["child_user_id"]);
  const managedBy = String(c["managed_by"]);
  const email = String(c["email"]);

  // 2. the sign-in record is still the managed placeholder of the guardian the database names
  const { data: found, error: readError } = await db.auth.admin.getUserById(childUserId);
  const user = found?.user;
  if (
    readError ||
    !user ||
    !isManagedUser(user) ||
    managedByOf(user) !== managedBy ||
    !isManagedEmail(user.email)
  ) {
    await release();
    throw readError
      ? errorInsteadOf(readError, say("HANDOVER_FAILED"))
      : new Error(say("HANDOVER_FAILED"));
  }
  const placeholder = user.email as string;

  // 3. the adult's confirmed address on the sign-in record, and no longer managed
  const { error: updateError } = await db.auth.admin.updateUserById(childUserId, {
    email,
    email_confirm: true,
    app_metadata: { managed: false, managed_by: null },
  });
  if (updateError) {
    await release();
    throw errorInsteadOf(updateError, say("HANDOVER_FAILED"));
  }

  // 4. the database finishes it, all or nothing
  const finished = (await db.rpc(
    "finish_managed_handover" as never,
    { _token_hash: tokenHash } as never,
  )) as RpcResult;
  const f = (finished.data ?? {}) as Record<string, unknown>;
  if (finished.error || f["ok"] !== true) {
    await putBack(db.auth.admin, childUserId, placeholder, managedBy);
    await release();
    if (finished.error) throw failure(finished.error, "HANDOVER_FAILED");
    throw new Error(say(f["code"]));
  }

  // 5. so the adult can choose a password without it ever touching this server
  let recoveryTokenHash: string | null = null;
  try {
    const { data: link, error: linkError } = await db.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    if (linkError) await report(linkError);
    recoveryTokenHash = link?.properties?.hashed_token ?? null;
  } catch (e) {
    await report(e);
  }
  return { recoveryTokenHash, childUserId };
}
