// Server-only: once a paid game's fee is verified, place the player on the
// roster so they don't depend on their own client running refreshStatus().
// Callers must have already verified the payment (host review or PayPal capture).
export async function addPaidPlayerToRoster(gameId: string, playerId: string, position?: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: game } = await supabaseAdmin
    .from("hosted_games")
    .select("id, requires_approval, cancelled_at")
    .eq("id", gameId)
    .maybeSingle();
  if (!game || (game as any).cancelled_at) return { added: false };

  // Approval-required games still need an approved request before rostering.
  if ((game as any).requires_approval) {
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
