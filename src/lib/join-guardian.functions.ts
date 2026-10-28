import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Host only: see `join-guardian.server`. */
export const getJoinGuardianNeeds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { gameId: string }) =>
    z.object({ gameId: z.string().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { guardianNeedsForGame } = await import("@/lib/join-guardian.server");
    return guardianNeedsForGame(supabaseAdmin as never, {
      gameId: data.gameId,
      callerId: context.userId,
    });
  });
