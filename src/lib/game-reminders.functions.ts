import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Delivers the caller's due game reminders as notification rows.
 *
 * For each game the caller has reminders on, the largest not-yet-sent offset
 * whose window has opened fires once; `last_sent_offset` guards against
 * duplicates so repeated calls are safe.
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
