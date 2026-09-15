/**
 * Integration test: `resolveOnboardingStatus` against a real profile row.
 *
 * The pure test suite (`onboarding-status.test.ts`) locks the decision matrix.
 * This suite defends against schema drift on `profiles.account_type` — it
 * signs in as the seeded player fixture, reads their real profile row, and
 * asserts the helper still classifies an email-provider player as
 * `needsOnboarding: false, isSocial: false`.
 *
 * Auto-skips when the seeded fixture accounts can't sign in.
 *
 * Run:
 *   bunx vitest run src/lib/onboarding.integration.test.ts
 */
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "./test-fixtures";
import { resolveOnboardingStatus } from "./onboarding.functions";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

const player = TEST_ACCOUNTS.find((a) => a.key === "player")!;

const skipIfNoBackend = !URL || !KEY;

describe.skipIf(skipIfNoBackend)("resolveOnboardingStatus (integration)", () => {
  let client: SupabaseClient;

  afterAll(async () => {
    if (client) await client.auth.signOut().catch(() => {});
  });

  it("classifies a signed-in email-provider player as onboarded + non-social", async () => {
    client = createClient(URL!, KEY!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storage: undefined,
      },
    });

    const { data: auth, error: signInError } = await client.auth.signInWithPassword({
      email: player.email,
      password: player.password,
    });
    if (signInError || !auth.user) {
      // Seeded fixture not present in this environment — skip at runtime.
      console.warn("Skipping: player fixture sign-in failed", signInError?.message);
      return;
    }

    const userId = auth.user.id;
    const { data: profile } = await client
      .from("profiles")
      .select("account_type")
      .eq("id", userId)
      .maybeSingle();

    const accountType = (profile as { account_type?: string | null } | null)?.account_type ?? null;

    // Session claims may or may not surface the provider; only identities
    // returned by the admin API are authoritative. Here we feed the shape
    // the handler sees for an email-only fixture user.
    const status = resolveOnboardingStatus({
      accountType,
      identities: [{ provider: "email" }],
      appMetadataProvider: auth.user.app_metadata?.provider ?? null,
      claimsProvider: null,
    });

    expect(status).toMatchObject({
      isSocial: false,
      needsOnboarding: false,
      accountType: "player",
    });
  });
});
