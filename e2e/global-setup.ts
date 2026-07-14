/**
 * Playwright global setup: mint a real Supabase session for the seeded
 * `e2e-player@lovable.test` fixture account and expose it to specs via
 * the same `LOVABLE_BROWSER_SUPABASE_*` env vars used in the sandbox.
 *
 * Runs once before any spec. Env mutations here propagate to Playwright
 * worker processes because they inherit process.env at spawn time.
 *
 * Skips silently (leaves the vars untouched) if the sandbox already
 * injected a session or if the Supabase URL/key are missing — the pay
 * specs then auto-skip as before rather than crashing the whole run.
 */
import { createClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "../src/lib/test-fixtures";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_PROJECT_ID =
  process.env.SUPABASE_PROJECT_ID ?? process.env.VITE_SUPABASE_PROJECT_ID;

export default async function globalSetup() {
  if (process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON && process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY) {
    // Sandbox already injected a session — leave it alone.
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_PROJECT_ID) {
    console.warn(
      "[e2e global-setup] Missing SUPABASE_URL / _PUBLISHABLE_KEY / _PROJECT_ID — session-required specs will skip.",
    );
    return;
  }

  const player = TEST_ACCOUNTS.find((a) => a.key === "player")!;

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
        "Run seedTestAccounts() from an admin session, then retry. Specs requiring auth will skip.",
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
