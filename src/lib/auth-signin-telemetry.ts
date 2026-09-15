// Client-side instrumentation for Google sign-in outcomes.
// Mirrored to the `auth_signin_events` table so we can quantify
// popup-block impact by device / browser and see whether retries succeed.

import { supabase } from "@/integrations/supabase/client";
import { parseBrowser } from "@/lib/location-denial-telemetry";

export type SigninEvent =
  | "attempt"
  | "popup_blocked"
  | "retry_clicked"
  | "success"
  | "failure"
  | "copy_link_clicked"
  // The provider window reported "cancelled/closed" but that signal is
  // unreliable on iOS Safari — we keep waiting for a session instead.
  | "inconclusive_wait"
  | "success_after_wait"
  | "wait_timeout";

export type SigninContext = {
  provider?: "google" | "apple";
  errorMessage?: string | null;
};

function detectPlatform(ua: string): string {
  if (/iPad|iPhone|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

export function detectSigninEnv() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isIOSChrome = isIOS && /CriOS/.test(ua);
  const isInAppWebview =
    /(FBAN|FBAV|Instagram|Line|Twitter|LinkedInApp|Snapchat|TikTok|WhatsApp|Wechat)/i.test(ua);
  return {
    userAgent: ua,
    browser: parseBrowser(ua),
    platform: detectPlatform(ua),
    isIOS,
    isIOSChrome,
    isInAppWebview,
  };
}

export function trackSigninEvent(event: SigninEvent, ctx: SigninContext = {}): void {
  if (typeof window === "undefined") return;
  const env = detectSigninEnv();
  const payload = {
    provider: ctx.provider ?? "google",
    event,
    error_message: ctx.errorMessage ? ctx.errorMessage.slice(0, 500) : null,
    user_agent: env.userAgent.slice(0, 500),
    browser: env.browser,
    platform: env.platform,
    is_ios: env.isIOS,
    is_ios_chrome: env.isIOSChrome,
    is_in_app_webview: env.isInAppWebview,
    viewport_width: window.innerWidth || null,
    viewport_height: window.innerHeight || null,
  };
  // Best-effort — never block the sign-in flow on telemetry.
  void (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const user_id = data?.user?.id ?? null;
      await supabase.from("auth_signin_events").insert({ ...payload, user_id });
    } catch {
      /* offline / RLS / network — ignore */
    }
  })();
}
