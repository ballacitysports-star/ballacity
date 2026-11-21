import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMyAgeStatus } from "@/lib/age-verification";
import { loadAnalyticsTag, setAnalyticsAudience, trackEvent } from "@/lib/analytics";
import { startWebVitals } from "@/lib/web-vitals";

const NEW_ACCOUNT_MS = 24 * 3600_000;

/**
 * The GA4 measurement id to use, or "" for none. Only the published build sends
 * anything: development builds (vite dev, the Playwright dev server and Lovable's
 * live preview) get "", so test and preview sessions never reach the production
 * GA4 property the navigation decision (P1-9) is read from.
 */
export function analyticsMeasurementId(): string {
  if (import.meta.env.DEV) return "";
  return ((import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) ?? "").trim();
}

/**
 * Switches funnel analytics on for confirmed adults, and only them, in the
 * published build. Renders nothing. Without a measurement id nothing mounts, so
 * not even the age check runs.
 */
export function AnalyticsHost() {
  const gaId = analyticsMeasurementId();
  return gaId ? <AnalyticsForAdults gaId={gaId} /> : null;
}

function AnalyticsForAdults({ gaId }: { gaId: string }) {
  const { user, loading } = useAuth();
  const age = useMyAgeStatus(!loading && !!user);
  const isAdult = !!user && age.data?.cohort === "adult" && !age.data.reviewRequired;

  useEffect(() => {
    // Until the age answer arrives the audience stays off, and a sign-out turns it off again.
    setAnalyticsAudience(isAdult);
    if (!isAdult) return;
    loadAnalyticsTag(gaId);
    // Page speed (P0-8), for adults only like everything else here.
    void startWebVitals();
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
  }, [gaId, isAdult, user]);

  return null;
}
