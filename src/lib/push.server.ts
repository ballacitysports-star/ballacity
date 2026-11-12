/**
 * Sends a OneSignal push to one user. Server only: it uses the service role for
 * the minor-notification curfew and the delivery log. The server functions that
 * call it decide who may notify whom.
 *
 * Never throws for provider errors: a push is auxiliary to the in-app
 * notification row, which the caller writes first.
 */
import { EXPIRED, HELD_CHECK_FAILED, HELD_FOR_CURFEW } from "@/lib/push-delivery";
import type { CurfewGate } from "@/lib/push-curfew.server";

export const ONESIGNAL_APP_ID = "c6024ea7-b1a2-4f64-b43a-783971d802f9";
export const ONESIGNAL_API = "https://api.onesignal.com/notifications";

export type PushInput = {
  userId: string;
  title: string;
  body?: string | null;
  url?: string | null;
  /**
   * When the push stops mattering (a game reminder: the game's start). A push that would be
   * delivered at or after this time, now or after being held, is not sent or queued; the
   * delivery log records it as skipped, "expired".
   */
  expiresAt?: string | null;
  /** The in-app notification this push mirrors; the delivery log links to it. */
  notificationId?: string | null;
};

type LogStatus = "sent" | "failed" | "skipped";
type Log = (
  status: LogStatus,
  extra?: { error?: string | null; detail?: unknown },
) => Promise<void>;

/** At or past the push's expiry, if it has one. */
function expiredAt(data: PushInput, deliverAtMs: number): boolean {
  const expires = data.expiresAt ? Date.parse(data.expiresAt) : Number.NaN;
  return Number.isFinite(expires) && deliverAtMs >= expires;
}

/**
 * Holds a push in scheduled_notifications for the flush job, which checks the
 * recipient's settings again before it sends. A push that would come out of the
 * hold at or after its expiry is dropped instead. A hold that cannot be written
 * is logged as failed: the push is then lost, never sent unchecked.
 */
async function hold(data: PushInput, log: Log, reason: string, deliverAfter: string) {
  if (expiredAt(data, Date.parse(deliverAfter))) {
    await log("skipped", {
      error: EXPIRED,
      detail: { held_for: reason, deliver_after: deliverAfter, expires_at: data.expiresAt },
    });
    return { ok: false as const, reason: EXPIRED };
  }
  let failure: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("scheduled_notifications" as any).insert({
      user_id: data.userId,
      title: data.title,
      body: data.body ?? null,
      url: data.url ?? null,
      channel: "push",
      reason,
      deliver_after: deliverAfter,
    } as any);
    if (error) failure = error.message;
  } catch (e) {
    failure = String(e);
  }
  if (failure) {
    console.warn("[push] could not hold the push", reason, failure);
    await log("failed", {
      error: "queue_failed",
      detail: { held_for: reason, deliver_after: deliverAfter, message: failure.slice(0, 300) },
    });
    return { ok: false as const, reason: "queue_failed" as const };
  }
  await log("skipped", { error: reason, detail: { deliver_after: deliverAfter } });
  return { ok: true as const, queued: true as const, deliverAfter };
}

/**
 * Push URLs must be absolute for the provider to open them. Callers normally
 * pass an absolute deep link; this backstops server-side callers that only
 * have an app-relative path.
 */
export async function absolutizeUrl(url: string | null): Promise<string | undefined> {
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

export async function deliverPush(data: PushInput) {
  const log: Log = async (status, extra = {}) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("notification_delivery_log" as any).insert({
        user_id: data.userId,
        notification_id: data.notificationId ?? null,
        channel: "push",
        status,
        provider: "onesignal",
        error: extra.error ?? null,
        detail: extra.detail ? (extra.detail as any) : null,
      } as any);
      if (error) console.warn("[push] delivery log insert failed", error.message);
    } catch (e) {
      console.warn("[push] delivery log insert failed", e);
    }
  };

  if (expiredAt(data, Date.now())) {
    await log("skipped", { error: EXPIRED, detail: { expires_at: data.expiresAt } });
    return { ok: false as const, reason: EXPIRED };
  }

  // Minor-safety curfew and the guardian's off switch. The in-app notification
  // row already exists (the caller writes it first), so holding a push here
  // never hides an alert from the member; it only delays the interruption.
  // Fails CLOSED: when the settings cannot be read, the push is held for the
  // flush job, which reads them again before it sends; it is never sent on a
  // guess.
  let gate: CurfewGate | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { curfewGateFor } = await import("@/lib/push-curfew.server");
    gate = await curfewGateFor(supabaseAdmin as any, data.userId);
  } catch (e) {
    console.warn("[push] curfew check failed; holding the push", e);
  }
  if (!gate) return hold(data, log, HELD_CHECK_FAILED, new Date().toISOString());
  if (gate.action === "blocked") {
    await log("skipped", { error: gate.reason });
    return { ok: false as const, reason: gate.reason };
  }
  if (gate.action === "queue") return hold(data, log, HELD_FOR_CURFEW, gate.deliverAfter);

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
