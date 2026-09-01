import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SAFETY_ACK_VERSION, type SafetyAckKind } from "@/lib/safety";

/**
 * Records that a user saw and accepted a safety acknowledgment for one game.
 * Idempotent: repeat taps hit the (user, game, kind, version) unique index and
 * are ignored instead of duplicating rows.
 */
export async function recordSafetyAck(input: {
  gameId: string;
  kind: SafetyAckKind;
  version?: string;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sign in to continue");
  const { error } = await supabase
    .from("game_safety_acknowledgments")
    .upsert(
      {
        user_id: u.user.id,
        game_id: input.gameId,
        kind: input.kind,
        version: input.version ?? SAFETY_ACK_VERSION,
        user_agent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 400),
      },
      { onConflict: "user_id,game_id,kind,version", ignoreDuplicates: true },
    );
  if (error) throw error;
}

/** Latest acknowledged version for this viewer + game + kind (null when none). */
export function useSafetyAck(gameId: string | null | undefined, kind: SafetyAckKind) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["safety-ack", user?.id ?? "anon", gameId ?? "none", kind],
    enabled: !!user && !!gameId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_safety_acknowledgments")
        .select("version, accepted_at")
        .eq("user_id", user!.id)
        .eq("game_id", gameId!)
        .eq("kind", kind)
        .order("accepted_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.version ?? null;
    },
  });
}

export function useRecordSafetyAck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recordSafetyAck,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["safety-ack"] });
    },
  });
}
