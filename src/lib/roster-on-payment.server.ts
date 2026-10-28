// Server-only: once a paid game's fee is verified, place the player on the
// roster so they don't depend on their own client running refreshStatus().
// Callers must have already verified the payment (host review or PayPal capture).
export async function addPaidPlayerToRoster(
  gameId: string,
  playerId: string,
  position?: string | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: game }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("hosted_games").select("id, cancelled_at").eq("id", gameId).maybeSingle(),
    // requires_approval lives with the payment settings, not on the game.
    supabaseAdmin
      .from("game_payment_settings")
      .select("requires_approval")
      .eq("game_id", gameId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!game || game.cancelled_at) return { added: false };

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
    if (!req) return { added: false };
  }

  const row: Record<string, unknown> = { game_id: gameId, user_id: playerId };
  if (position && position.trim()) row.position = position.trim();
  const { error } = await supabaseAdmin.from("game_participants").insert(row as never);
  if (error && error.code !== "23505") {
    console.error("[roster] auto-add after payment failed", error.message);
    return { added: false };
  }
  if (!error) {
    await supabaseAdmin.from("notifications").insert({
      user_id: playerId,
      type: "join_approved",
      title: "Payment confirmed — you're on the roster",
      body: "Your fee was confirmed by the host. See you at the game!",
      link: `/games/${gameId}`,
    } as never);
  }
  return { added: !error };
}
