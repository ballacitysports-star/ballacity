import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ONESIGNAL_APP_ID = "c6024ea7-b1a2-4f64-b43a-783971d802f9";
const ONESIGNAL_API = "https://api.onesignal.com/notifications";

type PushInput = {
  userId: string;
  title: string;
  body?: string | null;
  url?: string | null;
};

function validate(input: unknown): PushInput {
  const i = input as Partial<PushInput> | null | undefined;
  if (!i || typeof i.userId !== "string" || typeof i.title !== "string") {
    throw new Error("Invalid push input");
  }
  return {
    userId: i.userId,
    title: i.title.slice(0, 200),
    body: i.body ? String(i.body).slice(0, 500) : null,
    url: i.url ? String(i.url).slice(0, 500) : null,
  };
}

/**
 * Sends a OneSignal push to a single user, identified by their Supabase user id
 * (registered as the OneSignal external_id alias on the client).
 *
 * Returns { ok: true } on best-effort success. Never throws to the caller for
 * provider errors — pushes are auxiliary to the in-app notification row.
 */
export const sendPushToUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data }) => {
    const log = async (
      status: "sent" | "failed" | "skipped",
      extra: { error?: string | null; detail?: unknown } = {},
    ) => {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("notification_delivery_log" as any).insert({
          user_id: data.userId,
          channel: "push",
          status,
          provider: "onesignal",
          error: extra.error ?? null,
          detail: extra.detail ? (extra.detail as any) : null,
        } as any);
      } catch (e) {
        console.warn("[push] delivery log insert failed", e);
      }
    };

    const restKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!restKey) {
      console.warn("[push] ONESIGNAL_REST_API_KEY not configured");
      await log("skipped", { error: "not_configured" });
      return { ok: false as const, reason: "not_configured" };
    }
    try {
      const res = await fetch(ONESIGNAL_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${restKey}`,
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          target_channel: "push",
          include_aliases: { external_id: [data.userId] },
          headings: { en: data.title },
          contents: { en: data.body ?? "" },
          url: data.url ?? undefined,
        }),
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        console.warn("[push] OneSignal error", res.status, text);
        await log("failed", { error: `http_${res.status}`, detail: { body: text.slice(0, 500) } });
        return { ok: false as const, status: res.status };
      }
      // OneSignal returns 200 even when no recipients matched; surface that as a skip.
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
      const recipients = typeof parsed?.recipients === "number" ? parsed.recipients : null;
      if (recipients === 0) {
        await log("skipped", { error: "no_subscribers", detail: parsed });
        return { ok: true as const, recipients: 0 };
      }
      await log("sent", { detail: parsed ? { id: parsed.id, recipients } : null });
      return { ok: true as const, recipients };
    } catch (e) {
      console.warn("[push] fetch failed", e);
      await log("failed", { error: "fetch_failed", detail: { message: String(e) } });
      return { ok: false as const, reason: "fetch_failed" };
    }
  });
