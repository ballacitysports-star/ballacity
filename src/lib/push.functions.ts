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
 * Sends a OneSignal push to a single user, identified by their Supabase user id
 * (registered as the OneSignal external_id alias on the client).
 *
 * Returns { ok: true } on best-effort success. Never throws to the caller for
 * provider errors — pushes are auxiliary to the in-app notification row.
 */
export const sendPushToUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data, context }) => {
    if (data.userId !== context.userId) {
      const { data: allowed, error: relErr } = await context.supabase.rpc("can_notify" as any, {
        _caller: context.userId,
        _target: data.userId,
      });
      if (relErr || !allowed) {
        return { ok: false as const, reason: "not_authorized" };
      }
    }

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
  });

type PushSubscriptionSummary = {
  id: string | null;
  type: string | null;
  enabled: boolean;
  device: string | null;
};

/**
 * Testing tool: sends a sample push to the caller's own account and reports
 * whether OneSignal has this Supabase user linked (external_id) with at least
 * one enabled push subscription, plus the resulting delivery-log entry.
 */
export const sendTestPushToSelf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const i = (input ?? {}) as { title?: unknown; body?: unknown };
    return {
      title: typeof i.title === "string" && i.title.trim() ? i.title.trim().slice(0, 200) : null,
      body: typeof i.body === "string" && i.body.trim() ? i.body.trim().slice(0, 500) : null,
    };
  })
  .handler(async ({ data, context }) => {
    const restKey = process.env["ONESIGNAL_REST_API_KEY"];
    if (!restKey) {
      return {
        ok: false as const,
        reason: "not_configured" as const,
        linked: false,
        subscriptions: [] as PushSubscriptionSummary[],
        delivery: null,
      };
    }

    const headers = { "Content-Type": "application/json", Authorization: `Key ${restKey}` };

    // 1. Identity check — is this Supabase user linked as a OneSignal external_id?
    let linked = false;
    let subscriptions: PushSubscriptionSummary[] = [];
    let identityError: string | null = null;
    try {
      const res = await fetch(
        `https://api.onesignal.com/apps/${ONESIGNAL_APP_ID}/users/by/external_id/${encodeURIComponent(context.userId)}`,
        { headers },
      );
      if (res.ok) {
        const user: any = await res.json().catch(() => null);
        linked = Boolean(user);
        subscriptions = Array.isArray(user?.subscriptions)
          ? user.subscriptions
              .filter((s: any) => String(s?.type ?? "").toLowerCase() !== "email")
              .map((s: any) => ({
                id: s?.id ?? null,
                type: s?.type ?? null,
                enabled: s?.enabled !== false && s?.notification_types !== -2,
                device: s?.device_model ?? s?.device_os ?? null,
              }))
          : [];
      } else if (res.status === 404) {
        linked = false;
      } else {
        identityError = `http_${res.status}`;
      }
    } catch (e) {
      identityError = "identity_fetch_failed";
      console.warn("[push] identity lookup failed", e);
    }

    // 2. Send the sample push.
    const title = data.title ?? "Test alert from ballaCity";
    const body = data.body ?? "If you can see this, push notifications are working.";
    let sendStatus: number | null = null;
    let recipients: number | null = null;
    let sendError: string | null = null;
    try {
      const res = await fetch(ONESIGNAL_API, {
        method: "POST",
        headers,
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          target_channel: "push",
          include_aliases: { external_id: [context.userId] },
          headings: { en: title },
          contents: { en: body },
          url: "/notifications",
        }),
      });
      sendStatus = res.status;
      const text = await res.text().catch(() => "");
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* ignore */
      }
      if (!res.ok)
        sendError = parsed?.errors
          ? JSON.stringify(parsed.errors).slice(0, 300)
          : `http_${res.status}`;
      if (typeof parsed?.recipients === "number") recipients = parsed.recipients;
    } catch (e) {
      sendError = "fetch_failed";
      console.warn("[push] test send failed", e);
    }

    // 3. Record the attempt so it shows in delivery history.
    let delivery: { status: string; at: string } | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const status = sendError ? "failed" : recipients === 0 ? "skipped" : "sent";
      const { data: row } = await supabaseAdmin
        .from("notification_delivery_log" as any)
        .insert({
          user_id: context.userId,
          channel: "push",
          status,
          provider: "onesignal",
          error: sendError ?? (recipients === 0 ? "no_subscribers" : null),
          detail: { test: true, recipients, linked } as any,
        } as any)
        .select("status, created_at")
        .maybeSingle();
      delivery = row
        ? { status: (row as any).status, at: (row as any).created_at }
        : { status, at: new Date().toISOString() };
    } catch (e) {
      console.warn("[push] test delivery log failed", e);
    }

    const enabledSubs = subscriptions.filter((s) => s.enabled).length;
    return {
      ok: !sendError && (recipients ?? 0) > 0,
      linked,
      externalId: context.userId,
      subscriptions,
      enabledSubscriptions: enabledSubs,
      recipients,
      sendStatus,
      error: sendError,
      identityError,
      delivery,
    };
  });
