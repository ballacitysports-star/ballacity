import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ONESIGNAL_API, ONESIGNAL_APP_ID, type PushInput } from "@/lib/push-config";

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

    const { deliverPush } = await import("@/lib/push-delivery.server");
    return deliverPush(data);
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
