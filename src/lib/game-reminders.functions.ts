import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Delivers the caller's due game reminders as notification rows (and pushes).
 *
 * For each game the caller has reminders on, one reminder fires for the
 * smallest not-yet-sent window that has opened, and the larger windows pass
 * with it; `last_sent_offset` guards against duplicates so repeated calls are
 * safe. Only a caller with a place or an open join request gets one.
 */
export const flushMyDueGameReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // The same sweep the scheduler runs (P2-7), limited to the caller. Reminders are claimed
    // before they are written, so this and the scheduled run never send one twice.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendDueGameReminders } = await import("@/lib/game-reminders.server");
    const { sent } = await sendDueGameReminders(supabaseAdmin as never, {
      userId: context.userId,
    });
    return { sent };
  });
