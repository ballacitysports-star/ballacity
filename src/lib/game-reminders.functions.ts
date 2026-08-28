import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatNotificationWhen } from "@/lib/format";

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
    const userId = context.userId;
    const { data: rows, error } = await context.supabase
      .from("game_reminders" as any)
      .select("id, game_id, offsets, last_sent_offset")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const reminders = (rows ?? []) as unknown as {
      id: string;
      game_id: string;
      offsets: number[] | null;
      last_sent_offset: number | null;
    }[];
    if (reminders.length === 0) return { sent: 0 };

    const gameIds = [...new Set(reminders.map((r) => r.game_id))];
    const { data: games } = await context.supabase
      .from("hosted_games")
      .select("id, title, date, location, all_day")
      .in("id", gameIds);
    const byId = new Map(
      ((games ?? []) as any[]).map((g) => [String(g.id), g as Record<string, any>]),
    );

    const now = Date.now();
    let sent = 0;
    for (const r of reminders) {
      const game = byId.get(r.game_id);
      if (!game) continue;
      const startMs = new Date(String(game['date'])).getTime();
      if (!Number.isFinite(startMs) || startMs <= now) continue;
      const minutesToStart = (startMs - now) / 60000;
      const candidates = (r.offsets ?? [])
        .map(Number)
        .filter((m) => Number.isFinite(m) && m > 0)
        .filter((m) => m >= minutesToStart)
        .filter((m) => r.last_sent_offset == null || m < r.last_sent_offset)
        .sort((a, b) => b - a);
      const offset = candidates[0];
      if (offset == null) continue;

      const lead =
        offset >= 1440
          ? `${Math.round(offset / 1440)} day${offset >= 2880 ? "s" : ""}`
          : offset >= 60
            ? `${Math.round(offset / 60)} hour${offset >= 120 ? "s" : ""}`
            : `${offset} minutes`;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: insErr } = await supabaseAdmin.from("notifications").insert({
        user_id: userId,
        type: "game_reminder",
        title: `${game['title']} starts in ${lead}`,
        // All-day games never surface a clock time in reminders.
        body:
          [
            formatNotificationWhen({ date: String(game['date']), allDay: !!game['all_day'] }),
            game['location'] ? `Where: ${game['location']}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        link: `/games/${r.game_id}`,
      });
      if (insErr) continue;
      await context.supabase
        .from("game_reminders" as any)
        .update({ last_sent_offset: offset } as any)
        .eq("id", r.id);
      sent += 1;
    }
    return { sent };
  });
