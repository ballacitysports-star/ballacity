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
 * Pure decision function — mirrors the routing rules used by the server fn
 * below. Extracted so unit tests can exercise every identity / metadata /
 * claims combination without a live backend.
 *
 *  - An identity whose `provider` is in `SOCIAL_PROVIDERS` wins first:
 *    sets `isSocial: true` and `provider`.
 *  - Otherwise falls back to `appMetadataProvider` for `provider`; that path
 *    only flips `isSocial` when the metadata provider is itself social.
 *  - When `adminLookupFailed` is true, identities/appMetadata are ignored
 *    and `claimsProvider` is used (matching the catch branch in the handler).
 *  - `needsOnboarding` is true unless `accountType` is one of ALLOWED_TYPES.
 */
export function resolveOnboardingStatus(input: {
  accountType: string | null | undefined;
  identities?: Array<{ provider: string }> | null;
  appMetadataProvider?: string | null;
  claimsProvider?: string | null;
  adminLookupFailed?: boolean;
}): OnboardingStatus {
  const accountType =
    typeof input.accountType === "string" && ALLOWED_TYPES.has(input.accountType)
      ? input.accountType
      : null;

  let provider: string | null = null;
  let isSocial = false;

  if (input.adminLookupFailed) {
    const cp = input.claimsProvider;
    if (typeof cp === "string") {
      provider = cp;
      if (SOCIAL_PROVIDERS.has(cp)) isSocial = true;
    }
  } else {
    for (const identity of input.identities ?? []) {
      if (SOCIAL_PROVIDERS.has(identity.provider)) {
        isSocial = true;
        provider = identity.provider;
        break;
      }
    }
    if (!provider && typeof input.appMetadataProvider === "string") {
      provider = input.appMetadataProvider;
      if (SOCIAL_PROVIDERS.has(input.appMetadataProvider)) isSocial = true;
    }
  }

  return {
    needsOnboarding: accountType === null,
    isSocial,
    provider,
    accountType,
  };
}

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_type")
      .eq("id", userId)
      .maybeSingle();
    const accountType = (profile as { account_type?: string | null } | null)?.account_type ?? null;

    let identities: Array<{ provider: string }> = [];
    let appMetadataProvider: string | null = null;
    let adminLookupFailed = false;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      identities = (data?.user?.identities ?? []).map((i) => ({
        provider: i.provider,
      }));
      const meta = data?.user?.app_metadata?.provider;
      if (typeof meta === "string") appMetadataProvider = meta;
    } catch {
      adminLookupFailed = true;
    }

    const claimsProvider =
      typeof context.claims?.app_metadata?.provider === "string"
        ? (context.claims.app_metadata.provider as string)
        : null;

    return resolveOnboardingStatus({
      accountType,
      identities,
      appMetadataProvider,
      claimsProvider,
      adminLookupFailed,
    });
  });
