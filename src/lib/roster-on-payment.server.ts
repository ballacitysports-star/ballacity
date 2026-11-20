// Server-only: once a paid game's fee is verified, place the player on the
// roster so they don't depend on their own client running refreshStatus().
// Callers must have already verified the payment (host review or PayPal capture).
//
// When the place cannot be given (the game is cancelled, the host has not
// approved the request yet, or the roster refuses it: full, ended, closed...),
// the payment stays verified and the host and the player are both told in-app
// (notification type "payment_not_placed", in the Payment updates category),
// so a confirmed payment without a place is never silent.

/** Why a verified payment did not give the player a place. */
export type NotPlacedReason =
  "game_missing" | "already_on_roster" | "cancelled" | "approval_required" | "refused";

export type RosterOnPaymentResult =
  | { added: true }
  | {
      added: false;
      reason: NotPlacedReason;
      code?: string;
      /**
       * The "payment_not_placed" notices to the host and the player were written. Only set when the place could not
       * be given; false when writing them failed (the caller then has to tell both sides itself).
       */
      noticeSent?: boolean;
    };

/** True when the player holds the place after this call (newly added, or already there). */
export function holdsPlace(result: RosterOnPaymentResult): boolean {
  return result.added || result.reason === "already_on_roster";
}

/**
 * What a host's verify call reports about the place (ReviewPaymentResult.placed): true when the player holds it, false
 * only when they do not and both sides were sent the "payment_not_placed" notice, else null (the game is gone, or the
 * notice could not be written), so the host is never told of a notice that did not go out.
 */
export function placedAfterVerify(result: RosterOnPaymentResult): boolean | null {
  if (holdsPlace(result)) return true;
  return !result.added && result.noticeSent === true ? false : null;
}

/** The join gate's code at the start of a refused insert ("GAME_FULL: the roster is full."), if any. */
function refusalCode(message: string): string | undefined {
  return /^\s*([A-Z][A-Z_]*):/.exec(message)?.[1];
}

/**
 * Why, in a few words both sides may read. Only the game's own state is named; a rule about the player (age range,
 * a guardian's setting, a block) is not spelled out to the host.
 */
export function notPlacedWhy(code: string | undefined): string {
  switch (code) {
    case "GAME_FULL":
      return "the roster is full";
    case "GAME_COMPLETED":
      return "the game has ended";
    case "GAME_JOINS_CLOSED":
    case "GAME_SIGNUP_CLOSED":
      return "joining is closed";
    case "GAME_CANCELLED":
      return "the game was cancelled";
    default:
      return "the game's joining rules don't allow it";
  }
}

/** The in-app notices for a verified payment that did not give a place. */
export function notPlacedNotices(input: {
  reason: "cancelled" | "approval_required" | "refused";
  code?: string;
  gameId: string;
  gameTitle: string | null;
  hostId: string;
  playerId: string;
  playerName: string | null;
}) {
  const game = input.gameTitle?.trim() || "this game";
  const who = input.playerName?.trim() || "A player";
  const link = `/games/${input.gameId}`;
  const type = "payment_not_placed";
  const why =
    input.reason === "cancelled" ? notPlacedWhy("GAME_CANCELLED") : notPlacedWhy(input.code);
  const host =
    input.reason === "approval_required"
      ? `${who}'s payment for ${game} is confirmed, but you haven't approved their request for a spot yet. Approve it to give them their spot, or send their money back in your payment app.`
      : `${who}'s payment for ${game} is confirmed, but they couldn't be added to the roster: ${why}. Give them a spot if you can, or send their money back in your payment app.`;
  const player =
    input.reason === "approval_required"
      ? `Your payment for ${game} is confirmed, but the host still has to approve your request for a spot. They've been told.`
      : `Your payment for ${game} is confirmed, but you couldn't be added to the roster: ${why}. The host has been told. Ask them for your spot or your money back.`;
  return [
    {
      user_id: input.hostId,
      type,
      title: `Paid, not on the roster · ${who}`.slice(0, 200),
      body: host,
      link,
    },
    {
      user_id: input.playerId,
      type,
      title: "Payment confirmed, but you're not on the roster yet",
      body: player,
      link,
    },
  ];
}

export async function addPaidPlayerToRoster(
  gameId: string,
  playerId: string,
  position?: string | null,
): Promise<RosterOnPaymentResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The settings that count are the ones held by the game's payee (its host, or a minor host's payment manager).
  // A row written by anyone else is ignored even if it is the newest.
  const { data: payee } = await supabaseAdmin.rpc(
    "game_payee_id" as never,
    {
      _game_id: gameId,
    } as never,
  );
  const [{ data: game }, { data: settings }] = await Promise.all([
    supabaseAdmin
      .from("hosted_games")
      .select("id, host_id, title, cancelled_at")
      .eq("id", gameId)
      .maybeSingle(),
    // requires_approval lives with the payment settings, not on the game.
    supabaseAdmin
      .from("game_payment_settings")
      .select("requires_approval")
      .eq("game_id", gameId)
      .eq("host_id", (payee as unknown as string | null) ?? "00000000-0000-0000-0000-000000000000")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!game) return { added: false, reason: "game_missing" };

  /** The payment is verified and the place was not given: tell both sides, never fail the caller. */
  const notPlaced = async (
    reason: "cancelled" | "approval_required" | "refused",
    code?: string,
  ): Promise<RosterOnPaymentResult> => {
    let noticeSent = false;
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", playerId)
        .maybeSingle();
      const notices = notPlacedNotices({
        reason,
        code,
        gameId,
        gameTitle: (game as { title?: string | null }).title ?? null,
        hostId: (game as { host_id: string }).host_id,
        playerId,
        playerName: (profile as { display_name?: string | null } | null)?.display_name ?? null,
      });
      const { error } = await supabaseAdmin.from("notifications").insert(notices as never);
      if (error) console.error("[roster] not-placed notice failed", error.message);
      else noticeSent = true;
    } catch (e) {
      console.error("[roster] not-placed notice failed", e);
    }
    return code ? { added: false, reason, code, noticeSent } : { added: false, reason, noticeSent };
  };

  if (game.cancelled_at) return notPlaced("cancelled");

  // A player already on the roster keeps their place, whatever the approval setting says now: the host added them,
  // or they joined before approval was switched on (or before any settings row existed).
  const { data: onRoster, error: rosterReadError } = await supabaseAdmin
    .from("game_participants")
    .select("user_id")
    .eq("game_id", gameId)
    .eq("user_id", playerId)
    .limit(1)
    .maybeSingle();
  if (!rosterReadError && onRoster) return { added: false, reason: "already_on_roster" };

  // Approval-required games still need an approved request before rostering. A
  // game with no settings row is request-to-join, as the game page treats it.
  const requiresApproval = settings ? !!settings.requires_approval : true;
  if (requiresApproval) {
    const { data: req } = await supabaseAdmin
      .from("join_requests")
      .select("id")
      .eq("game_id", gameId)
      .eq("player_id", playerId)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();
    if (!req) return notPlaced("approval_required");
  }

  const row: Record<string, unknown> = { game_id: gameId, user_id: playerId };
  if (position && position.trim()) row.position = position.trim();
  const { error } = await supabaseAdmin.from("game_participants").insert(row as never);
  if (error?.code === "23505") return { added: false, reason: "already_on_roster" };
  if (error) {
    console.error("[roster] auto-add after payment failed", error.message);
    return notPlaced("refused", refusalCode(error.message ?? ""));
  }
  await supabaseAdmin.from("notifications").insert({
    user_id: playerId,
    type: "join_approved",
    title: "Payment confirmed — you're on the roster",
    body: "Your fee was confirmed by the host. See you at the game!",
    link: `/games/${gameId}`,
  } as never);
  return { added: true };
}
