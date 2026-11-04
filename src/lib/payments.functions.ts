import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Next = "verified" | "rejected" | "pending";
/** Any status a submission may currently hold (host actions only set `Next`). */
type From = Next | "disputed" | "cancelled";

export type ReviewPaymentResult = {
  ok: true;
  changed: boolean;
  submission: {
    id: string;
    status: From;
    screenshot_path: string | null;
    game_id: string;
    player_id: string;
    host_id: string;
  };
};

/**
 * Idempotent host action on a player's payment for a game.
 *
 * Guarantees enforced server-side (not just the RLS/insert grants):
 * - Only the host of the submission may act; caller must be signed in.
 * - If the latest submission already matches `next`, this is a no-op
 *   (`changed: false`) — repeated taps or duplicate tabs cannot log
 *   duplicate transitions or fire duplicate notifications.
 * - Optional `expectedFrom` gives optimistic concurrency: if the row
 *   changed under the caller since they loaded it, we return a 409-ish
 *   error instead of blindly overwriting.
 * - `mark-paid` (no prior submission + next="verified") inserts once;
 *   a concurrent second call sees the row and returns `changed: false`.
 *
 * The DB trigger `log_payment_verification_event` already skips writing
 * a history row when status is unchanged, so idempotency here also
 * prevents duplicate history entries.
 */
export const reviewPaymentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { gameId: string; playerId: string; next: Next; expectedFrom?: From | "none" }) => {
      if (!input?.gameId || typeof input.gameId !== "string") {
        throw new Error("gameId is required.");
      }
      if (!input?.playerId || typeof input.playerId !== "string") {
        throw new Error("playerId is required.");
      }
      if (!["verified", "rejected", "pending"].includes(input.next)) {
        throw new Error("Invalid next status.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }): Promise<ReviewPaymentResult> => {
    const { supabase, userId } = context;
    const { gameId, playerId, next, expectedFrom } = data;

    // Defense in depth: cohorts blocked from `game_payments` (see
    // PERMISSION_MATRIX in child-policy.ts) may never record or confirm a
    // payment, even if the client-side gate is bypassed. The database
    // trigger `enforce_game_payment_cohort` is the final backstop.
    //
    // SEC-2: the signed-in client can only ask the gate about itself (asking about someone else returns a fixed `false`).
    // The player check therefore runs with the service role, but only after the server has shown that the caller is this
    // game's host or payment manager AND the player is already linked to the game, so this function cannot be used to
    // probe an arbitrary account's age cohort.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: game, error: gameErr } = await supabaseAdmin
      .from("hosted_games")
      .select("host_id")
      .eq("id", gameId)
      .maybeSingle();
    if (gameErr) throw new Error(gameErr.message);
    let managesPayments = !!game && game.host_id === userId;
    if (game && !managesPayments) {
      // In the privacy release a minor-hosted game's payee is the guardian payment manager (absent on older schemas).
      const { data: payee, error: payeeErr } = await (supabaseAdmin.rpc as any)("game_payee_id", {
        _game_id: gameId,
      });
      managesPayments = !payeeErr && payee === userId;
    }
    if (!managesPayments) throw new Error("Only this game's host can review its payments.");
    const linked = await Promise.all([
      supabaseAdmin
        .from("game_participants")
        .select("user_id", { count: "exact", head: true })
        .eq("game_id", gameId)
        .eq("user_id", playerId),
      supabaseAdmin
        .from("join_requests")
        .select("id", { count: "exact", head: true })
        .eq("game_id", gameId)
        .eq("player_id", playerId)
        .in("status", ["pending", "approved"]),
      supabaseAdmin
        .from("payment_submissions")
        .select("id", { count: "exact", head: true })
        .eq("game_id", gameId)
        .eq("player_id", playerId),
    ]);
    if (!linked.some((r) => !r.error && (r.count ?? 0) > 0)) {
      throw new Error("This player isn't part of this game.");
    }

    for (const [party, id] of [
      ["host", userId],
      ["player", playerId],
    ] as const) {
      const client = party === "host" ? supabase : supabaseAdmin;
      const { data: allowed, error: gateErr } = await (client.rpc as any)("game_payments_allowed", {
        _user: id,
      });
      if (gateErr) throw new Error(gateErr.message);
      if (allowed === false) {
        throw new Error(
          party === "host"
            ? "Payment coordination isn't available for this account yet."
            : "Payment coordination isn't available for this player's account yet.",
        );
      }
    }

    // Latest submission for this (game, player) authored under this host.
    // RLS also scopes to the caller, but we filter explicitly so the
    // idempotency check is unambiguous.
    const { data: existing, error: readErr } = await supabase
      .from("payment_submissions")
      .select("id, status, screenshot_path, game_id, player_id, host_id")
      .eq("game_id", gameId)
      .eq("player_id", playerId)
      .eq("host_id", userId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    // No submission yet: only "verified" is meaningful (host marks as paid).
    if (!existing) {
      if (next !== "verified") {
        throw new Error("No payment submission to update.");
      }
      if (expectedFrom && expectedFrom !== "none") {
        throw new Error("Payment status changed since you loaded the page. Please refresh.");
      }
      const nowIso = new Date().toISOString();
      const { data: inserted, error: insErr } = await supabase
        .from("payment_submissions")
        .insert({
          player_id: playerId,
          game_id: gameId,
          host_id: userId,
          payment_method_id: null,
          payment_type: null,
          screenshot_path: null,
          notes: "Marked paid by host",
          paid_at: nowIso,
          status: "verified",
          reviewed_at: nowIso,
        } as never)
        .select("id, status, screenshot_path, game_id, player_id, host_id")
        .single();
      if (insErr) {
        // Race: another tab inserted first. Re-read and treat as no-op.
        const { data: after } = await supabase
          .from("payment_submissions")
          .select("id, status, screenshot_path, game_id, player_id, host_id")
          .eq("game_id", gameId)
          .eq("player_id", playerId)
          .eq("host_id", userId)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (after) {
          return {
            ok: true,
            changed: false,
            submission: after as ReviewPaymentResult["submission"],
          };
        }
        throw new Error(insErr.message);
      }
      {
        const { addPaidPlayerToRoster } = await import("./roster-on-payment.server");
        await addPaidPlayerToRoster(gameId, playerId).catch(() => {});
      }
      return {
        ok: true,
        changed: true,
        submission: inserted as ReviewPaymentResult["submission"],
      };
    }

    // Idempotent no-op: latest submission already in the requested state.
    if (existing.status === next) {
      return {
        ok: true,
        changed: false,
        submission: existing as ReviewPaymentResult["submission"],
      };
    }

    // Optimistic concurrency: reject conflicting concurrent transitions.
    if (expectedFrom && expectedFrom !== "none" && existing.status !== expectedFrom) {
      throw new Error(
        `Payment status changed since you loaded the page (now ${existing.status}). Please refresh.`,
      );
    }

    // Conditional update: only apply when the row is still in its prior status.
    // Serializes concurrent host clicks — the second one affects zero rows.
    const { data: updated, error: updErr } = await supabase
      .from("payment_submissions")
      .update({
        status: next,
        reviewed_at: next === "pending" ? null : new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("status", existing.status)
      .select("id, status, screenshot_path, game_id, player_id, host_id")
      .maybeSingle();
    if (updErr) throw new Error(updErr.message);

    if (!updated) {
      // Another writer beat us. Re-read and return current state as no-op.
      const { data: after } = await supabase
        .from("payment_submissions")
        .select("id, status, screenshot_path, game_id, player_id, host_id")
        .eq("id", existing.id)
        .maybeSingle();
      return {
        ok: true,
        changed: false,
        submission: (after ?? existing) as ReviewPaymentResult["submission"],
      };
    }

    if (next === "verified") {
      const { addPaidPlayerToRoster } = await import("./roster-on-payment.server");
      await addPaidPlayerToRoster(gameId, playerId).catch(() => {});
    }
    return {
      ok: true,
      changed: true,
      submission: updated as ReviewPaymentResult["submission"],
    };
  });
