import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  parsePromotionOutcomes,
  promotionNotification,
  type ClaimResult,
} from "@/lib/waitlist-promotion";

const gameInput = z.object({ gameId: z.string().min(1).max(100) });
const entryInput = z.object({ waitlistId: z.string().uuid() });

/** "OFFER_EXPIRED: the message" -> "the message". */
function friendlyMessage(raw: string): string {
  const m = raw.match(/^[A-Z_]+:\s*(.+)$/);
  return m?.[1] ?? raw;
}

/**
 * Fills the game's open spots from its waitlist (see `promote_next_waitlist_player`
 * for the rules) and alerts everyone whose status changed. The database function
 * is idempotent and serialised per game, so this is safe to call after any roster
 * change, from several clients at once, and as a periodic sweep.
 */
async function runPromotion(gameId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("promote_next_waitlist_player", {
    _game_id: gameId,
  });
  if (error) throw new Error(error.message);
  const outcomes = parsePromotionOutcomes(data);

  const link = `/games/${gameId}`;
  const alerts = outcomes.flatMap((o) => {
    const n = promotionNotification(o);
    return n ? [{ userId: o.userId, ...n }] : [];
  });
  if (alerts.length > 0) {
    const { error: insErr } = await supabaseAdmin.from("notifications").insert(
      alerts.map((a) => ({
        user_id: a.userId,
        type: a.type,
        title: a.title,
        body: a.body,
        link,
      })),
    );
    if (insErr) console.warn("[waitlist] notification insert failed", insErr.message);

    // Best-effort push so the alert reaches a closed app; the row above is the
    // record. Failures never undo the promotion.
    const { deliverPush } = await import("@/lib/push-delivery.server");
    await Promise.allSettled(
      alerts.map((a) => deliverPush({ userId: a.userId, title: a.title, body: a.body, url: link })),
    );
  }

  return {
    promoted: outcomes.filter((o) => o.outcome === "promoted").length,
    offered: outcomes.filter((o) => o.outcome === "offered").length,
    expired: outcomes.filter((o) => o.outcome === "expired").length,
  };
}

/**
 * Promotes the next eligible waitlist player(s) into any open spots. Free / open
 * runs auto-join the player; paid or approval-required runs hold the spot for a
 * 30 minute claim window and cascade to the next player if it lapses.
 *
 * Any signed-in user may call it: the result depends only on the game's state
 * (open spots and the queue), never on the caller, and it does nothing when the
 * game is full or the queue is empty.
 */
export const promoteNextWaitlistPlayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => gameInput.parse(d))
  .handler(async ({ data }) => runPromotion(data.gameId));

/** Waitlist entry (RLS-scoped to the caller) -> its game id. */
async function gameIdForOwnEntry(
  supabase: SupabaseClient<Database>,
  waitlistId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("game_position_waitlist")
    .select("game_id")
    .eq("id", waitlistId)
    .maybeSingle();
  return data?.game_id ?? null;
}

/**
 * Accepts the caller's spot offer. Free games put them straight on the roster
 * ("joined"); paid games hold the spot and send them to pay ("pay"), with the
 * host approval recorded for approval-required games. A lapsed offer is released
 * and the spot cascades to the next player ("expired").
 */
export const claimWaitlistOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => entryInput.parse(d))
  .handler(async ({ data, context }): Promise<{ result: ClaimResult; gameId: string }> => {
    const gameId = await gameIdForOwnEntry(context.supabase, data.waitlistId);
    if (!gameId) throw new Error("This spot offer is no longer available.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("claim_waitlist_offer", {
      _entry_id: data.waitlistId,
      _user: context.userId,
    });
    if (error) throw new Error(friendlyMessage(error.message));

    const result = (res as { result?: ClaimResult } | null)?.result;
    if (result !== "joined" && result !== "pay" && result !== "expired") {
      throw new Error("Could not claim this spot. Please try again.");
    }
    if (result === "expired") await runPromotion(gameId);
    return { result, gameId };
  });

/** Turns down the caller's spot offer; the spot rolls to the next player. */
export const declineWaitlistOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => entryInput.parse(d))
  .handler(async ({ data, context }) => {
    const gameId = await gameIdForOwnEntry(context.supabase, data.waitlistId);
    if (!gameId) throw new Error("This spot offer is no longer available.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("decline_waitlist_offer", {
      _entry_id: data.waitlistId,
      _user: context.userId,
    });
    if (error) throw new Error(friendlyMessage(error.message));

    await runPromotion(gameId);
    return { gameId };
  });
