import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMyAgeStatus } from "@/lib/age-verification";
import { loadAnalyticsTag, setAnalyticsAudience, trackEvent } from "@/lib/analytics";

const GA_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) ?? "";
const NEW_ACCOUNT_MS = 24 * 3600_000;

/**
 * Switches funnel analytics on for confirmed adults, and only them. Renders
 * nothing. Without a measurement id configured the tag is never loaded.
 */
export function AnalyticsHost() {
  const { user, loading } = useAuth();
  const age = useMyAgeStatus(!loading && !!user && !!GA_ID);
  const isAdult = !!user && age.data?.cohort === "adult" && !age.data.reviewRequired;

  useEffect(() => {
    if (!GA_ID) return;
    // Until the age answer arrives the audience stays off, and a sign-out turns it off again.
    setAnalyticsAudience(isAdult);
    if (!isAdult) return;
    loadAnalyticsTag(GA_ID);
    // Once per new account, on its first adult session; the local flag keeps a
    // second device or a reload from counting it twice on this browser.
    const createdAt = user?.created_at ? Date.parse(user.created_at) : NaN;
    if (user && Number.isFinite(createdAt) && Date.now() - createdAt < NEW_ACCOUNT_MS) {
      const key = `bc:signup-counted:${user.id}`;
      try {
        if (!window.localStorage.getItem(key)) {
          window.localStorage.setItem(key, "1");
          trackEvent("sign_up", {
            method: user.app_metadata?.provider === "email" ? "email" : "social",
          });
        }
      } catch {
        /* storage unavailable: skip rather than double count */
      }
    }
  }, [isAdult, user]);

  return null;
}
