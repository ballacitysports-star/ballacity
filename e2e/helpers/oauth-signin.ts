import { expect, type Page } from "@playwright/test";

/**
 * Helpers for the OAuth return specs (oauth-*.spec.ts, onboarding-null-account-type).
 *
 * Those specs restore the fixture session from storage and then raise the
 * `SIGNED_IN` event a Google/Apple return raises, so the root's sign-in
 * listener (`onAuthStateChange` in src/routes/__root.tsx) makes its decision.
 */

/**
 * The account-type picker the root gate renders in place of a protected page
 * for a member with no account type.
 */
export function accountTypePicker(page: Page) {
  return page.getByRole("heading", { name: /Where do you want to start/i });
}

/**
 * Wait until the app shell has mounted and its gate has shown the picker in
 * place. The root registers its sign-in listener when it mounts, after
 * hydration, so an event raised before that (e.g. right after
 * `goto(..., { waitUntil: "domcontentloaded" })`) reaches no one. The gate's
 * answer only renders after its own server checks, by which time the listener
 * is certainly there.
 */
export async function expectAccountTypePickerInPlace(page: Page) {
  await expect(accountTypePicker(page)).toBeVisible({ timeout: 20_000 });
}

/**
 * Raise `SIGNED_IN` on the app's own Supabase client with the stored session,
 * as an OAuth return does.
 *
 * - `provider: "google" | "apple"`: the session says it came from that provider.
 * - `provider: null`: the session carries no provider at all (stripped metadata).
 * - omitted: the stored session as it is.
 *
 * `getSession()` is patched to return the same session, so the listener's own
 * reads agree with the event.
 */
export async function emitSignedIn(
  page: Page,
  opts: { provider?: "google" | "apple" | null } = {},
) {
  const mode = opts.provider === undefined ? "keep" : opts.provider === null ? "strip" : "set";
  await page.evaluate(
    async ([m, providerId]) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const supabase = (mod as { supabase: import("@supabase/supabase-js").SupabaseClient })
        .supabase;
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) throw new Error("no session in test context");
      const appMetadata: Record<string, unknown> = { ...(session.user.app_metadata ?? {}) };
      if (m === "strip") delete appMetadata.provider;
      if (m === "set") appMetadata.provider = providerId;
      const patched = { ...session, user: { ...session.user, app_metadata: appMetadata } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const authAny = supabase.auth as any;
      authAny.getSession = async () => ({ data: { session: patched }, error: null });
      const emit = authAny._notifyAllSubscribers ?? authAny.notifyAllSubscribers;
      if (typeof emit !== "function") throw new Error("Supabase auth emit hook missing");
      await emit.call(supabase.auth, "SIGNED_IN", patched, false);
    },
    [mode, opts.provider ?? null] as const,
  );
}
