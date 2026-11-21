import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { errorInsteadOf } from "@/lib/error-report";
import { isManagedUser } from "@/lib/managed-children";
import {
  HANDOVER_DAYS,
  HANDOVER_EMAIL_MAX,
  handoverErrorMessage,
  handoverPath,
  isMissingFunctionError,
} from "@/lib/managed-handover";
import { knownErrorMessage } from "@/lib/user-error";

/**
 * Server side of the managed-account handover (docs/managed-account-handover.md).
 *
 * Starting runs with the service role for the signed-in guardian's id (so the token never reaches their browser); cancelling
 * and listing run with the guardian's own token. Either way every rule (only the managing guardian, only a known adult, the
 * address checks, the limits) is the database's, and every audit row names the guardian. The adult's calls are not signed in: the emailed token is the credential, and they run with the
 * service role in managed-handover.server.ts, which does only what the database's functions allow.
 */

type Ctx = {
  supabase: SupabaseClient<Database>;
  userId: string;
  claims: { app_metadata?: Record<string, unknown> };
};

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

/** A managed account's session (a guardian switched in) cannot hand anything over. */
function refuseManagedCaller(context: Ctx) {
  if (isManagedUser({ app_metadata: context.claims?.app_metadata ?? {} })) {
    throw new Error(handoverErrorMessage("MANAGED_SESSION_NOT_ALLOWED"));
  }
}

/** A refusal the person can act on reads as words; anything unexpected is reported and reads as the fallback. */
function failure(error: unknown, fallbackCode: string): Error {
  const known = knownErrorMessage(error);
  if (known) return new Error(known);
  return errorInsteadOf(error, handoverErrorMessage(fallbackCode));
}

export type StartedHandover = { expiresAt: string; emailMasked: string };

export const startManagedHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string; email: string; attested: true }) =>
    z
      .object({
        childUserId: z.string().uuid(),
        email: z.string().trim().min(1).max(HANDOVER_EMAIL_MAX),
        attested: z.literal(true),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<StartedHandover> => {
    const ctx: Ctx = context;
    refuseManagedCaller(ctx);
    const { hashHandoverToken, newHandoverToken } = await import("@/lib/managed-handover.server");
    const token = newHandoverToken();

    // The database decides everything: the guardian, the adult, the address, the limits. Nothing is sent until it agrees.
    // Only the server may start one (service role, with the id its auth middleware verified): the token is made here and
    // only its hash goes in, so it never reaches the guardian's browser and cannot be followed without the email.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const started = (await supabaseAdmin.rpc(
      "start_managed_handover" as never,
      {
        _guardian: ctx.userId,
        _child: data.childUserId,
        _email: data.email,
        _token_hash: hashHandoverToken(token),
      } as never,
    )) as RpcResult;
    if (started.error) {
      throw failure(
        started.error,
        isMissingFunctionError(started.error) ? "HANDOVER_UNAVAILABLE" : "HANDOVER_FAILED",
      );
    }
    const result = (started.data ?? {}) as Record<string, unknown>;
    if (result["ok"] !== true) throw new Error(handoverErrorMessage(result["code"]));

    const email = data.email.trim().toLowerCase();
    const expiresAt = String(result["expires_at"]);
    const emailMasked = String(result["email_masked"] ?? "");

    // Names for the email: the guardian's, and the account's first name. Best effort.
    let guardianName: string | undefined;
    let accountName: string | undefined;
    try {
      const { data: rows } = await ctx.supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", [ctx.userId, data.childUserId]);
      for (const r of (rows ?? []) as { id: string; display_name: string | null }[]) {
        if (r.id === ctx.userId) guardianName = r.display_name?.split(/\s+/)[0] || undefined;
        if (r.id === data.childUserId) accountName = r.display_name || undefined;
      }
    } catch {
      /* the email reads fine without names */
    }

    // Send the one-time link. If it cannot be sent, nothing may stay pending: cancel, so the guardian is not left waiting
    // for an email that will never come, and say so.
    let sent = false;
    let sendError: unknown = null;
    try {
      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      const res = await sendTemplateEmail("managed-handover", email, {
        templateData: {
          accountName,
          guardianName,
          handoverUrl: `https://ballacity.com${handoverPath(token)}`,
          expiresDays: HANDOVER_DAYS,
        },
        idempotencyKey: `managed-handover-${hashHandoverToken(token)}`,
      });
      sent = (res as { sent?: boolean }).sent === true;
    } catch (e) {
      sendError = e;
    }
    if (!sent) {
      await Promise.resolve(
        ctx.supabase.rpc("cancel_managed_handover" as never, { _child: data.childUserId } as never),
      ).catch(() => undefined);
      const words = handoverErrorMessage("HANDOVER_EMAIL_FAILED");
      // A suppressed recipient is an answer; a thrown failure is reported and read as words.
      throw sendError ? errorInsteadOf(sendError, words) : new Error(words);
    }
    return { expiresAt, emailMasked };
  });

export const cancelManagedHandover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { childUserId: string }) =>
    z.object({ childUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<{ cancelled: boolean }> => {
    const ctx: Ctx = context;
    refuseManagedCaller(ctx);
    const { data: cancelled, error } = (await ctx.supabase.rpc(
      "cancel_managed_handover" as never,
      {
        _child: data.childUserId,
      } as never,
    )) as RpcResult;
    if (error) {
      throw failure(
        error,
        isMissingFunctionError(error) ? "HANDOVER_UNAVAILABLE" : "HANDOVER_FAILED",
      );
    }
    return { cancelled: cancelled === true };
  });

const tokenSchema = z.object({ token: z.string().trim().min(32).max(128) });

/** The link page's read. Open to anyone holding the link: the token is the credential. */
export const lookupManagedHandover = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { lookupHandover } = await import("@/lib/managed-handover.server");
    return lookupHandover(data.token);
  });

/** The adult confirms: see managed-handover.server.ts for the steps. Open to anyone holding the link. */
export const completeManagedHandover = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string; confirmed: true }) =>
    tokenSchema.extend({ confirmed: z.literal(true) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { completeHandover } = await import("@/lib/managed-handover.server");
    const done = await completeHandover(data.token);
    return { recoveryTokenHash: done.recoveryTokenHash };
  });
