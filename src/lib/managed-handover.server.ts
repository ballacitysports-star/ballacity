/**
 * Server only. The adult's side of a managed-account handover (20261128100000, docs/managed-account-handover.md).
 *
 * The browser never decides anything here. The adult follows the emailed link; the app (this module, with the service
 * role) does, in this order, and stops at the first thing that fails:
 *
 *   1. claim_managed_handover   one finisher at a time, and the guardian cannot cancel under it.
 *   2. read the sign-in record  it must be the managed placeholder of the guardian the database names, or the half-done
 *                               record an earlier attempt of this same handover left (the adult's address, not managed).
 *   3. update the sign-in record  the adult's address, confirmed, no longer marked managed, and a random password nobody
 *                               knows (Admin API). The throwaway password is never stored, logged or returned.
 *   4. finish_managed_handover  the database re-checks everything, removes the managed row, revokes sessions and device
 *                               pairings, replaces every credential a guardian could have planted, ends the guardian
 *                               link, tells both sides once, closes the handover. One transaction, or nothing.
 *   5. a one-time sign-in link  so the adult sets their password in the browser (the password never reaches this server).
 *
 * Fail closed, decided from what the DATABASE says afterwards, never from the shape of the failure alone:
 *   - step 3 fails: nothing was finished; the claim is released.
 *   - step 4 fails: ask managed_handover_state. Row still there: the handover did not commit, so the sign-in record is put
 *     back (placeholder address, managed again) and the claim released. Row gone: it DID commit (a lost answer, or a
 *     second run that lost the race), so it is complete and step 5 goes on. State unreadable, or a transport error with
 *     no database code: nothing is put back (it might have committed); the claim is left to run out and the next entry
 *     point of the guardian (reconcileManagedRecord) repairs the record if the row is still there.
 *   - the process dies, or the put-back itself fails: the record is half done, with the managed row and link intact.
 *     reconcileManagedRecord (cancel, start, switch-in) puts the placeholder back; the adult can also retry the same link.
 * If step 5 fails the handover is already complete and the adult signs in with "Forgot password" on their own address.
 */
import { createHash } from "crypto";
import { errorInsteadOf } from "@/lib/error-report";
import {
  isManagedEmail,
  isManagedUser,
  managedByOf,
  managedEmailFor,
} from "@/lib/managed-children";
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

/** 32 random bytes as hex, set as the account's password and then forgotten: no one can ever sign in with it. */
function newThrowawayPassword(): string {
  return newHandoverToken();
}

/** A fresh placeholder address, as the guardian-created account had (nothing on managed.invalid can receive mail). */
function newPlaceholderEmail(): string {
  return managedEmailFor(globalThis.crypto.randomUUID().replace(/-/g, ""));
}

/** Step 3 undone (or a half-done record repaired): a placeholder address and the managed flag, as a new account has. */
async function restoreManagedRecord(
  auth: AdminAuth,
  childUserId: string,
  placeholder: string,
  managedBy: string,
): Promise<boolean> {
  const { error } = await auth.updateUserById(childUserId, {
    email: placeholder,
    email_confirm: true,
    app_metadata: { managed: true, managed_by: managedBy },
  });
  if (error) {
    await report(error);
    return false;
  }
  return true;
}

type HandoverState = {
  managed: boolean;
  managedBy: string | null;
  pending: boolean;
  claimLive: boolean;
};

/** What the database says about this account right now, or null when it cannot be read (never a guess). */
async function readState(
  db: Awaited<ReturnType<typeof admin>>,
  childUserId: string,
): Promise<HandoverState | null> {
  try {
    const { data, error } = (await db.rpc(
      "managed_handover_state" as never,
      { _child: childUserId } as never,
    )) as RpcResult;
    if (error || !data || typeof data !== "object") return null;
    const r = data as Record<string, unknown>;
    if (typeof r["managed"] !== "boolean") return null;
    return {
      managed: r["managed"],
      managedBy: typeof r["managed_by"] === "string" ? (r["managed_by"] as string) : null,
      pending: r["pending"] === true,
      claimLive: r["claim_live"] === true,
    };
  } catch {
    return null;
  }
}

export type ReconcileResult = "ok" | "repaired" | "busy" | "not_managed" | "unknown";

/**
 * Keep the sign-in record and the database in agreement for a MANAGED account: while the managed row exists, the sign-in
 * record must be the managed placeholder of that guardian, or the guardian cannot switch in. A handover step that died
 * half way (the adult's address set, the database never finished) leaves it otherwise; this puts it right.
 *
 * Only ever moves toward "managed": it does nothing when the managed row is gone (a finished handover), while somebody is
 * finishing one right now (a live claim), or when the state cannot be read. It never throws. Callers (cancel, start,
 * switch-in) have already checked that the signed-in person manages this account.
 */
export async function reconcileManagedRecord(childUserId: string): Promise<ReconcileResult> {
  try {
    const db = await admin();
    const st = await readState(db, childUserId);
    if (!st) return "unknown";
    if (!st.managed || !st.managedBy) return "not_managed";
    if (st.claimLive) return "busy";
    const { data, error } = await db.auth.admin.getUserById(childUserId);
    const user = data?.user;
    if (error || !user) {
      if (error) await report(error);
      return "unknown";
    }
    if (isManagedUser(user) && managedByOf(user) === st.managedBy && isManagedEmail(user.email)) {
      return "ok";
    }
    // Look once more right before writing: a handover that completed since the first read must not be undone.
    const again = await readState(db, childUserId);
    if (!again || !again.managed || again.claimLive)
      return again?.managed === false ? "not_managed" : "busy";
    return (await restoreManagedRecord(
      db.auth.admin,
      childUserId,
      newPlaceholderEmail(),
      st.managedBy,
    ))
      ? "repaired"
      : "unknown";
  } catch (e) {
    await report(e);
    return "unknown";
  }
}

export type CompletedHandover = {
  /** One-time token hash for supabase.auth.verifyOtp({ type: "recovery" }), or null if it could not be made. */
  recoveryTokenHash: string | null;
  childUserId: string;
};

/** A database-reported error (it ran and said no) carries a code; a lost connection does not. */
function databaseAnswered(error: { code?: string } | null | undefined): boolean {
  return typeof error?.code === "string" && error.code.length > 0;
}

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

  // 2. the sign-in record is the managed placeholder of the guardian the database names, or what an earlier attempt of
  //    this same handover left behind (the adult's confirmed address, not managed): both are safe to continue from.
  const { data: found, error: readError } = await db.auth.admin.getUserById(childUserId);
  const user = found?.user;
  const isPlaceholderRecord =
    !!user && isManagedUser(user) && managedByOf(user) === managedBy && isManagedEmail(user.email);
  const isHalfDoneRecord =
    !!user &&
    !isManagedUser(user) &&
    !!user.email_confirmed_at &&
    (user.email ?? "").toLowerCase() === email.toLowerCase();
  if (readError || !user || !(isPlaceholderRecord || isHalfDoneRecord)) {
    await release();
    throw readError
      ? errorInsteadOf(readError, say("HANDOVER_FAILED"))
      : new Error(say("HANDOVER_FAILED"));
  }
  const placeholder = isPlaceholderRecord ? (user.email as string) : newPlaceholderEmail();

  // 3. the adult's confirmed address on the sign-in record, no longer managed, and a password nobody knows
  const { error: updateError } = await db.auth.admin.updateUserById(childUserId, {
    email,
    email_confirm: true,
    password: newThrowawayPassword(),
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
    if (finished.error && !databaseAnswered(finished.error)) {
      // The answer was lost: the transaction may or may not have committed. Put nothing back on a guess.
      await report(finished.error);
      throw new Error(say("HANDOVER_UNSURE"));
    }
    const truth = await readState(db, childUserId);
    if (!truth) {
      if (finished.error) await report(finished.error);
      throw new Error(say("HANDOVER_UNSURE"));
    }
    if (truth.managed) {
      // Not committed: the account is still managed and linked, so the sign-in record must say so too.
      await restoreManagedRecord(db.auth.admin, childUserId, placeholder, managedBy);
      await release();
      if (finished.error) throw failure(finished.error, "HANDOVER_FAILED");
      throw new Error(say(f["code"]));
    }
    // The managed row is gone: the handover completed (this run's answer was lost, or another run finished it first).
    // Never put the record back; carry on to the sign-in link.
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
