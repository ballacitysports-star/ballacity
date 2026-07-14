/**
 * Playwright global setup: guarantee a signed-in Supabase session for the
 * seeded `e2e-player@lovable.test` fixture account and expose it to specs
 * via the same `LOVABLE_BROWSER_SUPABASE_*` env vars the pay-button specs
 * (and sandbox) already look for.
 *
 * Runs once before any spec. Env mutations here propagate to Playwright
 * worker processes because they inherit process.env at spawn time.
 *
 * Flow:
 *  1. If the sandbox already injected a session, pass it through.
 *  2. Otherwise, if a service role key is available, upsert the player
 *     fixture account (idempotent) via the Admin API so CI runs work
 *     without a pre-seeded database.
 *  3. Sign in with the fixture credentials via the publishable key and
 *     export the session.
 *
 * Missing env → warn + return; the specs auto-skip as before.
 */
import { createClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "../src/lib/test-fixtures";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_PROJECT_ID =
  process.env.SUPABASE_PROJECT_ID ?? process.env.VITE_SUPABASE_PROJECT_ID;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function globalSetup() {
  if (
    process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON &&
    process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY
  ) {
    // Sandbox already injected a session — pass through.
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_PROJECT_ID) {
    console.warn(
      "[e2e global-setup] Missing SUPABASE_URL / _PUBLISHABLE_KEY / _PROJECT_ID — session-required specs will skip.",
    );
    return;
  }

  const player = TEST_ACCOUNTS.find((a) => a.key === "player")!;

  // (2) Best-effort idempotent seed when a service role key is available.
  if (SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      });
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listErr) throw new Error(listErr.message);
      const metadata = {
        display_name: player.displayName,
        name: player.displayName,
        full_name: player.displayName,
      };
      const existing = list.users.find(
        (u) => u.email?.toLowerCase() === player.email.toLowerCase(),
      );
      if (!existing) {
        const { error } = await admin.auth.admin.createUser({
          email: player.email,
          password: player.password,
          email_confirm: true,
          user_metadata: metadata,
        });
        if (error && !/already/i.test(error.message)) throw error;
      } else {
        await admin.auth.admin.updateUserById(existing.id, {
          password: player.password,
          email_confirm: true,
          user_metadata: { ...(existing.user_metadata ?? {}), ...metadata },
        });
      }
    } catch (err) {
      console.warn(
        `[e2e global-setup] Could not upsert fixture account: ${
          err instanceof Error ? err.message : String(err)
        }. Falling through to sign-in attempt.`,
      );
    }
  }

  // (3) Sign in with the publishable key to mint a real user session.
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: player.email,
    password: player.password,
  });
  if (error || !data.session) {
    console.warn(
      `[e2e global-setup] Could not sign in ${player.email}: ${error?.message ?? "no session"}. ` +
        "Set SUPABASE_SERVICE_ROLE_KEY (or pre-seed the account) so global-setup can provision it. " +
        "Auth-required specs will skip.",
    );
    return;
  }

  const storageKey = `sb-${SUPABASE_PROJECT_ID}-auth-token`;
  process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY = storageKey;
  process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON = JSON.stringify(data.session);
  process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN = data.session.access_token;
  process.env.LOVABLE_BROWSER_AUTH_STATUS = "injected";

  console.log(`[e2e global-setup] Signed in ${player.email} for E2E specs.`);
}
