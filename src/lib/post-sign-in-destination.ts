import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { consumePostAuthRedirect } from "@/lib/post-auth-redirect";

const ONBOARDING_CHECK_TIMEOUT_MS = 2_500;

async function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(fallback), timeoutMs);
    promise.then(finish).catch(() => finish(fallback));
  });
}

export async function getPostSignInDestination(
  session: Session,
  fallback = "/profile",
): Promise<string> {
  const savedDestination = consumePostAuthRedirect(fallback);
  const onboardingCheck = Promise.resolve(
    supabase
      .from("profiles")
      .select("username")
      .eq("id", session.user.id)
      .maybeSingle(),
  ).then(({ data, error }) => (error ? false : !data?.username));

  const needsOnboarding = await withTimeout(
    onboardingCheck,
    false,
    ONBOARDING_CHECK_TIMEOUT_MS,
  );

  return needsOnboarding ? "/onboarding" : savedDestination;
}