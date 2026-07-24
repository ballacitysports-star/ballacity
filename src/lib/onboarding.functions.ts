import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_TYPES = new Set(["player", "team", "trainer", "gym"]);
const SOCIAL_PROVIDERS = new Set(["google", "apple"]);

export type OnboardingStatus = {
  needsOnboarding: boolean;
  isSocial: boolean;
  provider: string | null;
  accountType: string | null;
};

/**
 * Authoritative server-side onboarding guard.
 *
 * Even if the browser session lost `app_metadata.provider` (some OAuth return
 * paths on iOS/Android strip it, or the session was rebuilt from a refresh
 * token), the auth server still knows every identity linked to the user.
 * We inspect those identities directly, so a brand-new Google/Apple user
 * without an `account_type` is always classified as social and routed to
 * the onboarding picker.
 */
export const getOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingStatus> => {
    const { userId, supabase } = context;

    // Read the profile row under the user's own RLS.
    const { data: profile } = await supabase
      .from("profiles")
      .select("account_type")
      .eq("id", userId)
      .maybeSingle();
    const accountType =
      (profile as { account_type?: string | null } | null)?.account_type ?? null;

    // Detect social identities via the admin API — this is the authoritative
    // source and does not depend on `app_metadata.provider` being present in
    // the current session's JWT.
    let provider: string | null = null;
    let isSocial = false;
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      const identities = data?.user?.identities ?? [];
      for (const identity of identities) {
        const p = identity.provider;
        if (SOCIAL_PROVIDERS.has(p)) {
          isSocial = true;
          provider = p;
          break;
        }
      }
      if (!provider) {
        const meta = data?.user?.app_metadata?.provider;
        if (typeof meta === "string") provider = meta;
      }
    } catch {
      // If the admin lookup fails for any reason, fall back to session claims.
      const claimProvider = context.claims?.app_metadata?.provider;
      if (typeof claimProvider === "string") {
        provider = claimProvider;
        if (SOCIAL_PROVIDERS.has(claimProvider)) isSocial = true;
      }
    }

    const hasType = typeof accountType === "string" && ALLOWED_TYPES.has(accountType);
    return {
      needsOnboarding: !hasType,
      isSocial,
      provider,
      accountType: hasType ? accountType : null,
    };
  });
