import { ONESIGNAL_API, ONESIGNAL_APP_ID, type PushInput } from "@/lib/push-config";

/**
 * Push URLs must be absolute for the provider to open them. Callers normally
 * pass an absolute deep link; this backstops server-side callers that only
 * have an app-relative path.
 */
async function absolutizeUrl(url: string | null): Promise<string | undefined> {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  let origin = process.env["PUBLIC_SITE_URL"] ?? null;
  if (!origin) {
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest();
      const hdrOrigin = req?.headers?.get("origin");
      const host = req?.headers?.get("host");
      origin = hdrOrigin ?? (host ? `https://${host}` : null);
    } catch {
      origin = null;
    }
  }
  if (!origin) return undefined;
  try {
    return new URL(url, origin).toString();
  } catch {
    return undefined;
  }
}

/**
 * Server-only: delivers one OneSignal push (curfew + delivery log included).
 * Callers are responsible for authorising the target; `sendPushToUser` checks
 * `can_notify`, system flows (e.g. waitlist promotion) call this directly.
 */
export async function deliverPush(data: PushInput) {
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

  // Minor-safety curfew. The in-app notification row already exists (the
  // caller writes it first), so suppressing a push here never hides an alert
  // from the member — it only delays the interruption.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { curfewGateFor } = await import("@/lib/push-curfew.server");
    const gate = await curfewGateFor(supabaseAdmin as any, data.userId);
    if (gate.action === "blocked") {
      await log("skipped", { error: gate.reason });
      return { ok: false as const, reason: gate.reason };
    }
    if (gate.action === "queue") {
      await supabaseAdmin.from("scheduled_notifications" as any).insert({
        user_id: data.userId,
        title: data.title,
        body: data.body ?? null,
        url: data.url ?? null,
        channel: "push",
        reason: "minor_notification_curfew",
        deliver_after: gate.deliverAfter,
      } as any);
      await log("skipped", {
        error: "minor_notification_curfew",
        detail: { deliver_after: gate.deliverAfter },
      });
      return { ok: true as const, queued: true as const, deliverAfter: gate.deliverAfter };
    }
  } catch (e) {
    // A curfew lookup failure must not turn into a silent drop; log and send.
    console.warn("[push] curfew check failed", e);
  }

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
        url: await absolutizeUrl(data.url ?? null),
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
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }
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
}
