import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Time-on-platform heartbeat.
 *
 * Duration only: a session row's start and last-seen timestamp plus the
 * member's timezone. No page, no content, no behavioural profile. It exists so
 * average daily minutes can be reported for minor cohorts (Connecticut asks
 * for that figure) and so any future screen-time feature has real data.
 *
 * LEGAL REVIEW REQUIRED — retention of these rows is a privacy decision, not
 * an engineering one.
 */
export const recordSessionHeartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { timezone?: string | null }) => ({
    timezone:
      typeof input?.timezone === "string" ? input.timezone.slice(0, 64) : null,
  }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("record_session_heartbeat" as any, {
      _timezone: data.timezone,
    });
    if (error) return { ok: false as const, reason: error.message };
    return { ok: true as const };
  });
