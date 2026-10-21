import { useEntitlements } from "@/hooks/useEntitlements";
import type { FeatureAccess } from "@/lib/monetization/access";

/**
 * What a screen should ask before locking anything.
 *
 * Built on `useEntitlements` rather than re-querying, so mounting it alongside
 * other monetization hooks costs no extra `subscriptions` read. While BallaCity
 * is free this reports every entitlement held and every upsell suppressed.
 */
export function useFeatureAccess(): FeatureAccess & { loading: boolean } {
  const { access, loading } = useEntitlements();
  return { ...access, loading };
}
